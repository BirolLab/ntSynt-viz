#!/usr/bin/env Rscript

suppressPackageStartupMessages({
  library(argparse)
  library(treeio)
  library(ggpubr)
  library(ggtree)
  library(phytools)
  library(tidytree)
  library(dplyr)})

# Generate a cladogram from ntSynt distance newick file

# Parse the input arguments
parser <- ArgumentParser(
  description = "Generate a cladodogram from ntSynt distance newick file,\noutput suggested file order for ribbon plots"
)
parser$add_argument("--nwk", help = "Newick file", required = TRUE)
parser$add_argument("-p", "--prefix",
                    help = "Output prefix for file ordering (default ntsynt_dists)", required = FALSE,
                    default = "ntsynt_dists")
parser$add_argument("--lim", help = "Ratio adjustment for xlimits (default 0.1)",
                    required = FALSE, default = 0.1, type = "double")
parser$add_argument("--png", help = "Output cladogram in PNG format", required = FALSE,
                    action = "store_true")
parser$add_argument("--target", help = "Target genome to rotate to the top", required = FALSE)
parser$add_argument("--update_nwk", help = "Update output nwk after midpoint rooting", required = FALSE, action = "store_true")

args <- parser$parse_args()
treefile <- treeio::read.newick(args$nwk)
treefile

# check if edge lengths exist
if (is.null(treefile$edge.length)) {
  # set all branch lengths to 1
  cat(paste("No edge lengths found in the tree: ", args$nwk, ". Setting all branch lengths to 1.\n", sep=""))
  treefile$edge.length <- rep(1, nrow(treefile$edge))
  treefile
}

# If all edge lengths exist and are zero, set all branch lengths to 1
if (all(treefile$edge.length == 0)) {
  cat(paste("All edge lengths are zero in the tree: ", args$nwk, ". Setting all branch lengths to 1.\n", sep=""))
  treefile$edge.length <- rep(1, nrow(treefile$edge))
  treefile
}

if (!is.rooted(treefile)) {
  cat("Tree is not rooted. Midpoint rooting the tree.\n")
  treefile <- phytools::midpoint_root(treefile)
  treefile
}


# Rotate the target genome to the top
rotate_to_top <- function(tree, target) {
  # First, check that the target is valid
  if (!(target %in% tree$data$label)) {
    stop(paste(target, "not found in tree. Please double check correspondence with specified",
              "name conversion or synteny blocks.", sep=" "))
  }

  node <- parent(tree$data, which(tree$data$label == target))$node
  # Build up list of parent root nodes
  parent_nodes <- list()
  while (!is.null(node)) {
    parent_nodes <- c(parent_nodes, node)
    next_parent <- parent(tree$data, node)
    if (nrow(next_parent) > 0) {
      node <- next_parent$node
    } else {
      node <- NULL
    }
  }

  for (node in parent_nodes) {
    flipnodes <- child(tree$data, node)$node
    # If flipnodes is longer than 2, look for rotation which brings target genome to highest ymin position
    if (length(flipnodes) > 2) {
      cat(paste("Polytomy detected at node ", node, "\n"), sep="")
      # Iterate over each pair of nodes, and store the tree with the target genome in the highest ymin position
      curr_tree <- tree
      for (i in 1:(length(flipnodes)-1)) {
        for (j in (i+1):length(flipnodes)) {
          tmp_tree <- ggtree::flip(tree, flipnodes[i], flipnodes[j])
          with_rot <- get_clade_position(tmp_tree, which(tmp_tree$data$label == target))$ymin
          before <- get_clade_position(tree, which(tree$data$label == target))$ymin
          if (with_rot > before ) {
            curr_tree <- tmp_tree
          }

        }
      }
      tree <- curr_tree
    } else {
      # Bifurcation case, just flip the two nodes
      tmp_tree <- ggtree::flip(tree, flipnodes[[1]], flipnodes[[2]])
      with_rot <- get_clade_position(tmp_tree, which(tmp_tree$data$label == target))$ymin
      before <- get_clade_position(tree, which(tree$data$label == target))$ymin
      if (with_rot > before ) {
        tree <- tmp_tree
      }
    }
  }
  return(tree)
}

tree_ggtree <- ggtree(treefile, branch.length = "none") +
    geom_tiplab() + hexpand(ratio = args$lim)

if (!is.null(args$target)) {
  tree_ggtree <- rotate_to_top(tree_ggtree, args$target)
}

if (args$png) {
  ggsave(paste(args$prefix, ".cladogram.png", sep = ""), tree_ggtree, width = 25, height = 25, units = "cm",
         dpi = 300)
}

ordered_labels <- get_taxa_name(tree_ggtree)
write.table(ordered_labels, paste(args$prefix, ".order_tmp.tsv", sep = ""),
            quote = FALSE, row.names = FALSE, col.names = FALSE)

# write rotated newick tree to file 
if (args$update_nwk) {
  write.tree(as.phylo(tree_ggtree), file = paste(args$prefix, "_tmp.cladogram.nwk", sep = ""))
}