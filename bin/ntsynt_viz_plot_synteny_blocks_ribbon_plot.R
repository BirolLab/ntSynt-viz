#!/usr/bin/env Rscript
suppressPackageStartupMessages({
  library(ape)
  library(argparse)
  library(scales)
  library(ggtree)
  library(treeio)
  library(phytools)
  library(dplyr)
  library(ggpubr)
  library(stringr)
  library(gggenomes)
  library(tidyr)
  library(svglite)
  library(ggiraph)})

# Example script for generating ntSynt synteny ribbon plots using gggenomes

# Parse the input arguments
parser <- ArgumentParser(description = "Plot the ntSynt synteny blocks ribbon plot using gggenomes")
parser$add_argument("-s", "--sequences", help = "Input sequence lengths TSV", required = TRUE)
parser$add_argument("-l", "--links", help = "Synteny block links", required = TRUE)
parser$add_argument("-c", "--painting", help = "File with chromosome painting information", required = FALSE)
parser$add_argument("--centromeres", help = "File with centromere positions", required = FALSE, default = NULL)
parser$add_argument("--scale", help = "Length of scale bar in bases (default 1 Gbp)", default = 1e9,
                    required = FALSE, type = "double")
parser$add_argument("--width", help = "Width of plot in cm (default 50)", default = 50,
                    required = FALSE, type = "double")
parser$add_argument("--height", help = "Height of plot in cm (default 20)", default = 20,
                    required = FALSE, type = "double")
parser$add_argument("--tree", help = "Newick-formatted cladogram", required = FALSE)
parser$add_argument("--no-arrow", help = paste("Do not plot arrows indicating reverse complementation.",
                                                "Only use when blocks were normalized."),
                    action = "store_true", default = FALSE)
parser$add_argument("--haplotypes", help = "TSV with haplotype nudges", required = FALSE)
parser$add_argument("--colour_indices", help = "TSV with information about colour selection", required = TRUE)
parser$add_argument("--ratio",
                    help = paste("Ratio adjustment for labels on left side of the ribbon plot.",
                                 "Increase if the labels are cut-off,",
                                 "decrease to decrease space between ribbon plot and cladogram"),
                    default = 0.1, required = FALSE, type = "double")
parser$add_argument("--right-ratio",
                    help = paste("Ratio adjustment for space on the right side of the ribbon plot.",
                                 "Increase if the labels on the right are cut-off,",
                                 "decrease to decrease space between ribbon plot and right edge of the plot"),
                    default = 0.07, required = FALSE, type = "double")
parser$add_argument("-p", "--prefix",
                    help = "Output prefix for PNG image (default synteny_gggenomes_plot)", required = FALSE,
                    default = "synteny_gggenomes_plot")
parser$add_argument("--format", help = "Output format for image (png, pdf or svg)", required = FALSE,
                    default = "png", choices = c("png", "pdf", "svg"))
parser$add_argument("--order", help = "TSV file with desired order of tip labels (only used if --tree specified).", required = FALSE)
parser$add_argument("--dpi", help = "Output plot resolution - for PNG only (default 300)", default = 300, required = FALSE, type = "integer")
parser$add_argument("--interactive-picking-method", "--interactive-renderer",
                    dest = "interactive_picking_method",
                    help = paste("Picking method for ribbons in the interactive HTML.",
                                 "'svg' preserves the existing ggiraph output;",
                                 "'webgl' uses WebGL with an indexed CPU fallback (default webgl)."),
                    default = "webgl", choices = c("svg", "webgl"))
parser$add_argument("--annotate-genome-info", help = "Add annotations about number of sequences and genome size to the right of each bin",
                    action = "store_true")

args <- parser$parse_args()

# Print console messages with a date/time prefix.
log_message <- function(...) {
  message <- paste(..., collapse = " ")
  cat(sprintf("[%s] %s\n", format(Sys.time(), "%Y-%m-%d %H:%M:%S"), message))
}

#############################
# Prepare data
#############################

# Read in and prepare sequences
sequences <- read.csv(args$sequences, sep = "\t", header = TRUE) %>%
  mutate(relative_orientation = if_else(relative_orientation == "+", "", "\u2190"))


# Prepare name conversions for tree
name_conversions <- sequences %>%
  select(bin_id) %>%
  mutate(bin_id_translate = str_replace_all(bin_id, "_", " "))

# https://stackoverflow.com/questions/32378108/using-gtoolsmixedsort-or-alternatives-with-dplyrarrange
sequences <- sequences %>%
  mutate(bin_id = str_replace_all(bin_id, "_", " "))
input_order <- unique(sequences$bin_id)
input_chrom_order <- unique(sequences$seq_id)

sequences <- sequences %>%
  arrange(factor(bin_id, levels = input_order))

# Read in and prepare synteny links
links_ntsynt <- read.csv(args$links,
                         sep = "\t", header = TRUE) %>%
  mutate(bin_id = str_replace_all(bin_id, "_", " "),
         bin_id2 = str_replace_all(bin_id2, "_", " "))
target_genome <- links_ntsynt %>% head(1) %>% select(bin_id) %>% pull()
log_message("Target genome:", target_genome)
links_ntsynt$seq_id <- factor(links_ntsynt$seq_id,
                              levels = input_chrom_order)
links_ntsynt <- links_ntsynt %>% arrange(factor(seq_id, levels = input_chrom_order))
links_ntsynt$seq_id2 <- as.character(links_ntsynt$seq_id2)
links_ntsynt$colour_block <- factor(links_ntsynt$colour_block,
                                    levels = input_chrom_order)

# Prepare scale bar data frame
scale <- args$scale

scale_bar <- tibble(x = c(0), xend = c(scale),
                    y = c(0), yend = c(0))

# Infer best units for scale bar
label <- paste(scale, "bp", sep = " ")
if (scale %% 1e9 == 0) {
  label <- paste(scale / 1e9, "Gbp", sep = " ")
} else if (scale %% 1e6 == 0) {
  label <- paste(scale / 1e6, "Mbp", sep = " ")
} else if (scale %% 1e3 == 0) {
  label <- paste(scale / 1e3, "kbp", sep = " ")
}

# Read in the data frame for chromosome painting features
painting <- read.csv(args$painting, sep = "\t", header = TRUE) %>%
  mutate(bin_id = str_replace_all(bin_id, "_", " "))

# Read in the data frame with info about colours to choose for sequences
colours_df <- read.csv(args$colour_indices, sep = "\t", header = TRUE)

# Read in haplotypes, or set to FALSE
if (! is.null(args$haplotypes)) {
  haplotype_data <- read.csv(args$haplotypes, sep = "\t", header = TRUE) %>%
    mutate(bin_id = str_replace_all(bin_id, "_", " "),
           nudge_next = lead(nudge, default = 0))
  haplotypes <- list(
    nudge = setNames(haplotype_data$nudge, haplotype_data$bin_id),
    nudge_next = setNames(haplotype_data$nudge_next, haplotype_data$bin_id)
  )
} else {
  haplotypes <- FALSE
}

if (! is.null(args$centromeres)) {
  centromeres <- read.csv(args$centromeres, sep = "\t", header = TRUE)
} else {
  centromeres <- FALSE
}

#############################
# Helper functions
#############################

# Get the y coordinates for the features
get_y_coord <- function(haplotypes, bin_id, y, end=FALSE) {
  if (typeof(haplotypes) == "logical") {
    return(y)
  }

  offsets <- if (end) haplotypes$nudge_next else haplotypes$nudge
  offsets <- unname(offsets[as.character(bin_id)])
  offsets[is.na(offsets)] <- 0
  y + offsets
}

format_genome_size <- function(bp) {
  dplyr::case_when(
    bp >= 1e9 ~ paste0(sprintf("%.1f", bp / 1e9), " Gbp"),
    bp >= 1e6 ~ paste0(sprintf("%.1f", bp / 1e6), " Mbp"),
    bp >= 1e3 ~ paste0(sprintf("%.1f", bp / 1e3), " kbp"),
    TRUE      ~ paste0(bp, " bp")
  )
}

# Return dataframe with bin annotations
get_bin_annotations <- function(seq_data){
  bin_stats <- seq_data %>%
  group_by(bin_id) %>%
  summarise(
    n_chr       = n(),
    genome_size = sum(length),
    y           = max(y),           
    x_right     = max(xend)
  ) %>%
  mutate(label = paste0("\u00A0\u00A0\u00A0", format_genome_size(genome_size), ";  n=", n_chr)) 

  bin_stats <- bin_stats %>% mutate(x_right = max(bin_stats$x_right))
  return(bin_stats)
}

# Prepare a summary string for each synteny block
get_block_coord_info <- function(link_data, max_genome_len, max_chrom_len) {
  block_coords <- link_data %>%
    group_by(block_id) %>%
    summarise(
      coords = {
        # Each row contributes two genomes; collect all unique combinations
        g1 <- tibble(genome = bin_id,  chrom = seq_id,  start = start,  end = end, strand = strand1)
        g2 <- tibble(genome = bin_id2, chrom = seq_id2, start = start2, end = end2, strand = strand2)
        bind_rows(g1, g2) %>%
          distinct() %>%
          mutate(line = paste0(stringr::str_pad(genome, width = max_genome_len, side="right", pad='\u00A0'),
                              " ", 
                              stringr::str_pad(chrom, width = max_chrom_len, side="right", pad='\u00A0'),
                              ": ",
                              format(start, big.mark=","), " – ",
                              format(end,   big.mark=","), " bp (", strand, ")")) %>%
          pull(line) %>%
          paste(collapse = "\n")
      },
      .groups = "drop"
    )
    return(block_coords)
}

# Get the information/data about synteny links for interactive layers with ggiraph
get_link_info <- function(link_data) {
  n_links <- nrow(link_data)

  tibble(
    group_id = rep(seq_len(n_links), each = 4),
    px = as.vector(rbind(link_data$x, link_data$xend,
                         link_data$xmax, link_data$xmin)),
    py = as.vector(rbind(link_data$y, link_data$y,
                         link_data$yend, link_data$yend)),
    data_id = rep(link_data$block_id, each = 4),
    colour_block = rep(link_data$colour_block, each = 4)
  )
}

# Quote a value for use as a JavaScript string literal. This keeps the generated
# maps valid when identifiers or tooltips contain quotes, slashes or newlines.
quote_js_string <- function(value) {
  value <- enc2utf8(as.character(value))
  value <- gsub("\\", "\\\\", value, fixed = TRUE)
  value <- gsub("\"", "\\\"", value, fixed = TRUE)
  value <- gsub("\b", "\\b", value, fixed = TRUE)
  value <- gsub("\f", "\\f", value, fixed = TRUE)
  value <- gsub("\n", "\\n", value, fixed = TRUE)
  value <- gsub("\r", "\\r", value, fixed = TRUE)
  value <- gsub("\t", "\\t", value, fixed = TRUE)
  value <- gsub("\u2028", "\\u2028", value, fixed = TRUE)
  value <- gsub("\u2029", "\\u2029", value, fixed = TRUE)
  paste0("\"", value, "\"")
}

serialize_js_numeric_array <- function(values) {
  encoded <- ifelse(
    is.finite(values),
    sprintf("%.17g", as.numeric(values)),
    "null"
  )
  paste0("[", paste(encoded, collapse = ","), "]")
}

serialize_webgl_data <- function(data) {
  links <- data$links
  paste0(
    "{\"x_range\":", serialize_js_numeric_array(data$x_range),
    ",\"y_range\":", serialize_js_numeric_array(data$y_range),
    ",\"links\":{",
    "\"x1\":", serialize_js_numeric_array(links$x1), ",",
    "\"x2\":", serialize_js_numeric_array(links$x2), ",",
    "\"x3\":", serialize_js_numeric_array(links$x3), ",",
    "\"x4\":", serialize_js_numeric_array(links$x4), ",",
    "\"y1\":", serialize_js_numeric_array(links$y1), ",",
    "\"y2\":", serialize_js_numeric_array(links$y2), ",",
    "\"block_id\":[", paste(quote_js_string(links$block_id), collapse = ","), "]",
    "}}"
  )
}

# Build chromosome -> block_id and block_id -> tooltip mappings. Chromosomes
# from the target genome are the entries that appear in the legend.
build_js_maps <- function(link_data, target_genome, block_coords) {
  chrom_block_map <- link_data %>%
    filter(bin_id == target_genome) %>%
    select(block_id, seq_id) %>%
    distinct() %>%
    group_by(seq_id) %>%
    summarise(block_ids = list(unique(block_id)), .groups = "drop") %>%
    rename(chrom = seq_id)

  js_map_entries <- chrom_block_map %>%
    rowwise() %>%
    mutate(entry = paste0(
      quote_js_string(chrom), ': [',
      paste(quote_js_string(unlist(block_ids)), collapse = ","),
      ']'
    )) %>%
    pull(entry) %>%
    paste(collapse = ",\n")

  tooltip_map_entries <- block_coords %>%
    transmute(entry = paste0(
      quote_js_string(block_id), ": ",
      quote_js_string(paste0("Block ID: ", block_id, "\n", coords))
    )) %>%
    pull(entry) %>%
    paste(collapse = ",\n")

  js_maps <- paste0(
    "const chromBlockMap = window.ntsyntChromBlockMap = {\n", js_map_entries, "\n};\n",
    "const blockTooltipMap = window.ntsyntBlockTooltipMap = {\n", tooltip_map_entries, "\n};"
  )
  return(js_maps)
}

# Make the ribbon plot - these layers can be fully customized as needed
make_plot <- function(links, sequences, painting, colours_df, add_scale_bar = FALSE,
                      centromeres = FALSE, add_arrow = FALSE, haplotypes = FALSE,
                      include_ribbon_hit_layer = TRUE) {
  target_genome <- (sequences %>% head(1) %>% select(bin_id))[[1]]
  sequences_filt <- unique((sequences %>% filter(bin_id == target_genome))$seq_id)
  num_colours <- unique(colours_df$num_seqs)
  colours <- hue_pal()(num_colours)[colours_df$colour_index]
  
  if (is.data.frame(centromeres)) {
    p <-  gggenomes(seqs = sequences, links = links, feats = list(painting, centromeres))
  } else {
    p <-  gggenomes(seqs = sequences, links = links, feats = list(painting))
  }

  # Materialize the computed gggenomes coordinates once. These tables are reused
  # for annotations, interactive layers, tooltips, and JavaScript mappings.
  links_plot <- pull_links(p)
  seqs_plot <- pull_seqs(p)

  plot <- p + theme_gggenomes_clean(base_size = 15)

  plot <- plot +
    geom_link(aes(fill = colour_block,
                  y = get_y_coord(haplotypes, .data$bin_id, .data$y),
                  yend = get_y_coord(haplotypes, .data$bin_id, .data$yend, end = TRUE)),
              offset = 0, alpha = 0.5, linewidth = 0.05)

  plot <- plot +
  geom_seq(aes(y = get_y_coord(haplotypes, .data$bin_id, .data$y),
               yend = get_y_coord(haplotypes, bin_id, .data$y)),
               size = 2, colour = "darkgrey") + # draw contig/chromosome lines
  geom_feat(data = feats(painting), aes(colour = as.factor(colour_block),
                y = get_y_coord(haplotypes, bin_id, .data$y),
               yend = get_y_coord(haplotypes, bin_id, .data$y)), position = "identity", linewidth = 2) +
  geom_bin_label(aes(label = bin_id,
                    y = get_y_coord(haplotypes, bin_id, .data$y)),
                size = 6, fontface = "italic") + # label each bin
  theme(axis.text = element_text(size = 25, face = "italic"),
        legend.position = "bottom",
        legend.text = element_text(size = 15, margin = margin(r=10, l=3))) +
  scale_fill_manual(values = colours,
                    breaks = sequences_filt) +
  scale_colour_manual(values = colours,
                      breaks = sequences_filt) +
  guides(fill = guide_legend(title = "", ncol = 10),
          colour = guide_legend(title = ""))

  if (add_arrow) {
    plot <- plot + geom_seq_label(aes(label = relative_orientation, 
                                      x = pmax(.data$x, .data$xend),
                                      y = get_y_coord(haplotypes, bin_id, .data$y)), nudge_y = -0.05, 
                                  size = 3.25, hjust = 1) 
  }
  xmax <- ggplot_build(plot)$layout$panel_params[[1]]$x.range[[2]]
  plot <- plot + xlim(0 - xmax * args$ratio, NA)

  if (is.data.frame(centromeres)) {
    plot <- plot + geom_feat(data = feats(centromeres), position = "identity",
                             linewidth = 2, colour = "black")
  }

  if (add_scale_bar) {
    plot <- plot + geom_segment(data = scale_bar, aes(x = x, xend = xend, y = y, yend = yend),
                                linewidth = 1.5) +
      geom_text(data = scale_bar, aes(x = x + (xend / 2), y = y - 0.4, label = label), size = 5) +
      theme(axis.line.x = element_blank(),
            axis.title.x = element_blank(),
            axis.text.x = element_blank(),
            axis.ticks.x = element_blank())
  }

  if (args$annotate_genome_info) {
    bin_stats <- get_bin_annotations(seqs_plot)
    
    plot <- plot + geom_text(data = bin_stats, aes(x = x_right, y = y, label = label, hjust = 0),
                             size = 4) +
                  expand_limits(x = max(bin_stats$x_right) + (xmax * (args$right_ratio)))
  }

  # Prepare interactive components
  # Combine all unique genome/chrom combinations across the dataset
  all_elements <- bind_rows(
    links_plot %>% select(genome = bin_id,  chrom = seq_id,  start, end),
    links_plot %>% select(genome = bin_id2, chrom = seq_id2, start = start2, end = end2)
  ) %>% distinct()

  # Find the maximum string length of the genome IDs to know how much to pad for hover boxes
  max_genome_len <- max(nchar(all_elements$genome), na.rm = TRUE)
  max_chrom_len  <- max(nchar(all_elements$chrom), na.rm = TRUE)

  block_coords <- get_block_coord_info(links_plot, max_genome_len, max_chrom_len)
  link_data <- get_link_info(links_plot)

  # The SVG renderer uses transparent polygons for native hit testing. WebGL
  # mode omits them and identifies ribbons through an off-screen picking buffer.
  if (include_ribbon_hit_layer) {
    plot <- plot +
      geom_polygon_interactive(
        data = link_data,
        aes(
          x       = px,
          y       = py,
          group   = group_id,
          data_id = data_id,
          fill = colour_block
        ),
        alpha = 0,
        hover_nearest = FALSE
      )
  }

  # Prepare information about chromosomes for interactive layers
  seq_data <- seqs_plot %>%
    mutate(
      length_fmt = format(length, big.mark = ",", scientific = FALSE),
      tooltip = paste0(
        "Genome: ",     bin_id,      "\n",
        "Chromosome: ", seq_id,      "\n",
        "Length: ",     length_fmt,  " bp"
      )
    )
    # Add interactive layer for chromosomes
  plot <- plot +
    geom_segment_interactive(
      data = seq_data,
      aes(
        x     = x,
        xend  = xend,
        y     = y,
        yend  = y,
        tooltip  = tooltip,
        data_id  = seq_id
      ),
      linewidth = 3, # Increased area to hit for hover box
      alpha     = 0,
      hover_nearest = FALSE
    )

  # Build map of chromosome -> block_id for interactive legend
  js_map <- build_js_maps(links_plot, target_genome, block_coords)

  panel_params <- ggplot_build(plot)$layout$panel_params[[1]]
  webgl_links <- links_plot %>%
    transmute(
      x1 = x,
      x2 = xend,
      x3 = xmax,
      x4 = xmin,
      y1 = get_y_coord(haplotypes, bin_id, y),
      y2 = get_y_coord(haplotypes, bin_id, yend, end = TRUE),
      block_id = as.character(block_id)
    )

  webgl_data <- list(
    x_range = unname(panel_params$x.range),
    y_range = unname(panel_params$y.range),
    links = webgl_links
  )

  return(list(
    plot = plot,
    js_map = js_map,
    webgl_data = webgl_data,
    x_range = unname(panel_params$x.range),
    y_range = unname(panel_params$y.range)
  ))
}

#############################
# Prepare plots
#############################

# Make the ribbon plot
log_message("Generating ribbon plot...")
use_svg_ribbon_hit_layer <- args$interactive_picking_method == "svg"
synteny_plot_tmp <- make_plot(links_ntsynt, sequences, painting, colours_df, add_scale_bar = TRUE, centromeres = centromeres,
                              add_arrow = !args$no_arrow, haplotypes = haplotypes,
                              include_ribbon_hit_layer = use_svg_ribbon_hit_layer)
synteny_plot <- synteny_plot_tmp$plot
js_map       <- synteny_plot_tmp$js_map
webgl_data   <- if (args$interactive_picking_method == "webgl") synteny_plot_tmp$webgl_data else NULL


if (is.null(args$tree)) {
  # If no tree is provided, just plot the synteny blocks
  plots <- synteny_plot
} else {
  # Prepare the tree
  ntsynt_tree <- treeio::read.newick(args$tree)
  log_message(capture.output(print(ntsynt_tree)))

  if (!is.null(args$order)) {
    orders <- read.csv(args$order, sep = "\t", header = FALSE)
    colnames(orders) <- c("label")
    # reverse to ensure target genome is at the top
    desired_order <- rev(orders$label)

    # Ensure labels match before rotation - sanity check
    if (!all(desired_order %in% as.phylo(ntsynt_tree)$tip.label)) {
      stop("Error: Some labels in the order file are not present in the tree.")
    }
    tree_phylo <- as.phylo(ntsynt_tree)
    new_tree <- rotateConstr(tree_phylo, desired_order)
    new_tree <- rename_taxa(new_tree, name_conversions)
    ntsynt_ggtree <- ggtree(new_tree, branch.length = "none", ladderize = FALSE)
    tip_order_plot <- ntsynt_ggtree$data[ntsynt_ggtree$data$isTip, ] %>%
      arrange(y) %>%
      pull(label)
    if (! identical(tip_order_plot, str_replace_all(desired_order, "_", " "))) {
      log_message("Tip order in plot:", paste(tip_order_plot, collapse = ", "))
      log_message("Desired tip order:",
                  paste(str_replace_all(desired_order, "_", " "), collapse = ", "))
      stop("Error: Tip order in the plot does not match the new tree after rotation.")
    }
  } else {
    ntsynt_tree <- rename_taxa(ntsynt_tree, name_conversions)
    ntsynt_ggtree <- ggtree(ntsynt_tree, branch.length = "none")
  }

  # Align the plots properly
  synteny_y_range <- synteny_plot_tmp$y_range

  plots <- ggarrange(
    ntsynt_ggtree + scale_y_continuous(limits = synteny_y_range, expand = c(0, 0)),
    (synteny_plot %>% pick_by_tree(ntsynt_ggtree)),
    common.legend = TRUE, align = "hv",
    widths = c(1, 10), legend = "bottom"
  )

}

any_rc <- length((sequences %>% filter(relative_orientation != ""))$relative_orientation) > 0
if (any_rc && !args$no_arrow) {
  note <- text_grob("sequences reverse complemented with --normalize indicated with arrows", size = 15)
  plots <- ggarrange(plots, note, ncol = 1, heights = c(10, 1))
}

# Save static plot in requested format
if (args$format == "pdf") {
  ggsave(paste0(args$prefix, ".pdf"), plots,
         units = "cm", width = args$width, height = args$height, bg = "white")
  log_message("Plot saved:", paste0(args$prefix, ".pdf"))
} else if (args$format == "svg") {
  ggsave(paste0(args$prefix, ".svg"), plots,
         units = "cm", width = args$width, height = args$height, bg = "white")
  log_message("Plot saved:", paste0(args$prefix, ".svg"))
} 
png(paste0(args$prefix, ".png"), units = "cm", width = args$width, height = args$height,
    res = args$dpi, bg = "white")
print(plots)
dev.off()
log_message("Plot saved:", paste0(args$prefix, ".png"))



# Prepare interactive HTML
interactive_plots <- plots

log_message("Generating interactive HTML...")

command_args <- commandArgs(trailingOnly = FALSE)
script_arg <- command_args[grep("--file=", command_args)]
script_dir <- dirname(normalizePath(sub("--file=", "", script_arg)))
js_template <- paste(
  readLines(paste(script_dir, "/ntsynt_viz_ribbon-interactive.js", sep=""), warn = FALSE),
  collapse = "\n"
)

js_inject <- gsub(
  "__CHROM_BLOCK_MAP__",
  js_map,
  js_template,
  fixed = TRUE
)

if (args$interactive_picking_method == "webgl") {
  webgl_template <- paste(
    readLines(paste(script_dir, "/ntsynt_viz_ribbon-webgl.js", sep=""), warn = FALSE),
    collapse = "\n"
  )
  webgl_json <- serialize_webgl_data(webgl_data)
  js_inject <- paste(
    js_inject,
    gsub("__WEBGL_RIBBON_DATA__", webgl_json, webgl_template, fixed = TRUE),
    sep = "\n"
  )
}

interactive_plot <- girafe(
  ggobj = interactive_plots,
  width_svg  = args$width  / 2.54, # Converting to inches
  height_svg = args$height / 2.54,
  options = list(
    opts_zoom(max = 10),
    opts_toolbar(pngname = args$prefix),
    opts_sizing(rescale = TRUE, width = 1),
    opts_tooltip(
      delay_mouseover = 50,
      delay_mouseout = 50,
      css = paste(
        "background: rgba(255,255,255,0.9);",
        "padding: 10px;",
        "border: 1px solid black;",
        "border-radius: 4px;",
        "font-family: monospace;",
        "font-size: 16px;"
      )
    )
  )
)

# Inject CSS to ensure the interactive plot fills a browser window
css_override <- paste(
  "<style>",
  ".girafe.html-widget { width: 100% !important; height: 90vh !important; }",
  "</style>",
  sep = "\n"
)

html_file <- paste0(args$prefix, ".html")
htmlwidgets::saveWidget(interactive_plot, html_file, selfcontained = TRUE, title = args$prefix)
html_content <- readLines(html_file, warn = FALSE)
head_close <- which(grepl("</head>", html_content))
html_content <- append(html_content, css_override, after = head_close - 1)
body_close <- which(grepl("</body>", html_content))
html_content <- append(html_content, js_inject, after = body_close - 1)
writeLines(html_content, html_file)
log_message("Interactive HTML saved:", html_file)
