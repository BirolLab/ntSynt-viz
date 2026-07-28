#!/usr/bin/env python3
"""
Generate a markdown "context" file summarizing an ntSynt ribbon plot,
intended to be handed to an LLM (of the user's choice) to produce a
short manuscript-ready summary. Does NOT call an LLM itself.
"""
import argparse
import csv
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

LLM_INSTRUCTIONS = """
## Instructions
#### Output format
The tables below describe a multi-genome synteny (ribbon plot) comparison,
for use in a scientific manuscript. Using ONLY the data provided, write
2-3 sentences in clear, formal, manuscript-appropriate language summarizing
overall structural trends: whether the genomes are largely collinear/
syntenic or show substantial structural rearrangement; any notable
large-scale fusions/fissions and which genomes are involved; and any
standout individual inversions or genomes with a disproportionate share
of inversion relative to the others.

#### Fusion / fission description rules
When describing a specific fusion or fission, always name the chromosome
accession(s) involved for both genomes (e.g., \"A. example1 XXX.1 corresponds
to YYY.1 and ZZZ.1 in A. example2\"), not just the genomes.
When a chromosome in one genome corresponds to two chromosomes in all other
genomes, describe it as a single event in the odd-one-out genome (fusion or
fission, whichever direction is more parsimonious) rather than as independent
events in each of the other genomes.

Chromosome correspondence table: use it only to identify fusions/fissions.
Do not report the % syntenic length values directly. Only pairs contributing a non-trivial share of a chromosome's
syntenic content are informative for calling a fusion/fission -- the
% column distinguishes small/stray correspondences from real ones.

General: do not restate raw numbers verbatim from any table -- synthesize a
trend instead, and do not enumerate every row.

#### Companion image usage
If a companion image of the ribbon plot is provided and you are able to view
it, use it only for overall visual impression (e.g. density, general
complexity) and to confirm whether specific table-derived events are
discernible at the plot's scale. Do not estimate numbers from the image --
rely on the tables for any numeric, comparative, or quantitative claims.

Before describing any table-derived event (fusion, fission, inversion) as
notable or visually prominent, check the image to confirm it is large enough
to be apparent at the plot's scale. If a real event is too small to be
visible, still report it but explicitly note it is small-scale rather
than calling it visually obvious. Conversely, if something is visually
striking in the image, confirm with the tables which chromosome accession is
responsible before naming it.

When confirming that a table-derived event is visible in the image, state
only whether it is discernible at the plot's scale. Acceptable: \"consistent
with the [colour] segment visible on chromosome X.\" Do not characterize how
visually prominent, striking, or subtle it appears -- see the general
language rules below.

#### Multi-genome framing 
Remember that the comparisons are multi-genome, meaning that every synteny
block contains coordinates from each genome -- there is no concept of
separate pairwise comparisons when interpreting the plot.

#### Phylogenetic tree rules
If a phylogenetic tree is provided, derive all statements about which
genomes are \"closely related,\" \"sister taxa,\" etc. strictly from the tree
topology -- never from the structural consistency or correspondence tables.
Use the tables only to say whether structural patterns are consistent or
inconsistent with the tree relationships, not to define them.

#### General language rules
Avoid non-scientific, unfalsifiable, or aesthetic language throughout,
including superlatives (exceptional, amazing, remarkable) and subjective
visual descriptors (modest, striking, subtle, understated).

#### Disclaimer
Always print a separate disclaimer that a human expert should review the
summary before including it in a presentation or publication.
"""

SYNTENY_COLS = [
    "block_id", "genome", "chrom", "start", "end",
    "strand", "num_minimizers", "reason",
]

@dataclass
class SyntenyRow:
    """Describes a row in the synteny TSV file"""
    block_id: int
    genome: str
    chrom: str
    start: int
    end: int
    strand: str
    num_minimizers: int
    reason: str

def load_synteny_tsv(path):
    """Read synteny TSV file"""
    rows = []
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.reader(f, delimiter="\t")
        for fields in reader:
            if not fields:
                continue
            row = SyntenyRow(
                block_id=int(fields[0]),
                genome=fields[1],
                chrom=fields[2],
                start=int(fields[3]),
                end=int(fields[4]),
                strand=fields[5],
                num_minimizers=int(fields[6]),
                reason=fields[7]
            )
            rows.append(row)
    return rows


def load_normalization_tsv(path):
    """Load the information about chromosome normalization"""
    with open(path, newline="", encoding="utf-8") as f:
        lines = [line for line in f if not line.startswith("#")]
    reader = csv.reader(lines, delimiter="\t")
    next(reader)  # header
    rows = []
    for fields in reader:
        if not fields:
            continue
        rows.append({
            "genome": fields[0],
            "chromosome": fields[1],
            "relative_orientation": fields[2],
        })
    return rows

def read_lengths_tsv(path):
    """Read a TSV with headers bin_id,seq_id,length,relative_orientation and return a dict of lengths."""
    lengths = defaultdict(dict)
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.reader(f, delimiter="\t")
        next(reader)  # header
        for fields in reader:
            if not fields:
                continue
            bin_id = fields[0]
            seq_id = fields[1]
            length = int(fields[2])
            lengths[bin_id][seq_id] = length
    return lengths


def get_genome_order(rows):
    """Genome order is fixed and identical within every block; read it
    off the first block."""
    first_block_id = rows[0].block_id
    order = []
    for row in rows:
        if row.block_id != first_block_id:
            break
        order.append(row.genome)
    return order


def normalization_summary(norm_rows):
    """Per-genome fraction of chromosomes reverse-complemented during
    normalization."""
    counts = defaultdict(lambda: [0, 0])  # genome -> [flipped, total]
    for row in norm_rows:
        counts[row["genome"]][1] += 1
        if row["relative_orientation"] == "-":
            counts[row["genome"]][0] += 1
    return {genome: tuple(v) for genome, v in counts.items()}


def chromosome_correspondence(rows, genome_order, chrom_lengths):
    """For each genome pair and direction, syntenic bp and % of genome A
    chromosome's total syntenic length, per (chrom_a, chrom_b)."""
    results = []
    genomes = genome_order

    by_genome = defaultdict(dict)
    for r in rows:
        by_genome[r.genome][r.block_id] = r

    for ga in genomes:
        for gb in genomes:
            if ga == gb:
                continue
            a_rows = by_genome[ga]
            b_rows = by_genome[gb]

            pair_totals = defaultdict(int)
            for block_id, a_row in a_rows.items():
                b_row = b_rows.get(block_id)
                if b_row is None:
                    continue
                chrom_a = a_row.chrom
                chrom_b = b_row.chrom
                length_a = a_row.end - a_row.start
                pair_totals[(chrom_a, chrom_b)] += length_a

            for (chrom_a, chrom_b), bp in pair_totals.items():
                pct = 100 * bp / chrom_lengths[ga][chrom_a]
                results.append({
                    "genome_a": ga, "chrom_a": chrom_a,
                    "genome_b": gb, "chrom_b": chrom_b,
                    "syntenic_bp": bp, "pct_of_chrom_a": round(pct, 1),
                })
    return results


def inversion_summary(rows, genome_order, top_n=5):
    """Per-genome proportion of syntenic length that is inverted relative
    to the first genome in the provided order (strand '-'), plus the
    top_n largest individually inverted blocks."""
    first_genome = genome_order[0]

    totals = defaultdict(int)
    inverted_totals = defaultdict(int)
    for r in rows:
        totals[r.genome] += (r.end - r.start)
        if r.strand == "-":
            inverted_totals[r.genome] += (r.end - r.start)

    per_genome = []
    for genome in genome_order:
        total_len = totals.get(genome, 0)
        inv_len = inverted_totals.get(genome, 0)
        pct = round(100 * inv_len / total_len, 1) if total_len > 0 else None
        per_genome.append({
            "genome": genome,
            "inverted_length": inv_len,
            "pct_inverted": pct,
        })

    inverted_blocks = [
        r for r in rows if r.strand == "-" and r.genome != first_genome
    ]
    inverted_blocks.sort(key=lambda r: (r.end - r.start), reverse=True)
    top = inverted_blocks[:top_n]

    return per_genome, top, first_genome


def build_header():
    """Build the markdown header"""
    return [
        "# Synteny Ribbon Plot Summary Context",
        "",
        "<!--",
        "This file is generated by the ntSynt pipeline to accompany a ribbon plot.",
        "It is intended to be given to an LLM of the user's choice (text-only or",
        "vision-capable) to produce a short, manuscript-ready summary of the plot.",
        "It is NOT consumed by any LLM inside the pipeline itself.",
        "-->",
        "",
    ]


def build_about_section(first_genome):
    """Build the about information section"""
    about_text = f"""
## About this plot
This data describes a multi-genome synteny comparison. A **synteny
block** is a genomic region conserved between genomes; an **inversion**
is a block in reversed orientation relative to {first_genome}, the
first-listed genome (chosen only for its position in the input order,
not as a biological reference); a **fusion/fission** is a case where
regions from one chromosome in one genome correspond to multiple
chromosomes in another.

If a companion image is provided: each chromosome in the top genome is assigned a distinct
color; ribbon width corresponds to syntenic block length; a
twisted/crossed ribbon indicates an inverted block; genomes are
arranged in the order listed below.
Optionally, a phylogenetic tree is rendered to the left of the ribbon plot.
Arrows under chromosomes indicate reverse complementation during normalization (also optional).
    """
    return [about_text]

def build_genome_table(genome_order, norm_summary):
    """Build genome table for markdown"""
    lines = [
        "## Genomes Compared",
        "",
        "Listed in the order shown in the ribbon plot.",
        "",
        "| Order | Genome | Normalization (optional) |",
        "|---|---|---|",
    ]

    for i, genome in enumerate(genome_order, 1):
        if genome not in norm_summary:
            note = "—"
        else:
            flipped, total = norm_summary[genome]
            note = (
                "—"
                if flipped == 0
                else f"{flipped}/{total} chromosomes reverse-complemented during normalization"
            )

        lines.append(f"| {i} | {genome} | {note} |")

    lines.append("")
    return lines

def build_chromosome_table(chrom_results):
    """Build chromosome correspondence table for markdown"""
    lines = [
        "## Chromosome Correspondence (fusions / fissions)",
        "",
        "Only pairs contributing a non-trivial share:",
        "",
        "| Genome A | Chr A | Genome B | Chr B | Syntenic bp | % of Chr A Syntenic Length |",
        "|---|---|---|---|---|---|",
    ]

    for row in chrom_results:
        lines.append(
            f"| {row['genome_a']} | "
            f"{row['chrom_a']} | "
            f"{row['genome_b']} | "
            f"{row['chrom_b']} | "
            f"{row['syntenic_bp']} | "
            f"{row['pct_of_chrom_a']}% |"
        )

    lines.append("")
    return lines

def build_inversion_table(inv_per_genome, inv_top, first_genome):
    """Build table summarizing inversions"""
    lines = [
        "## Inversion Summary",
        "",
        f"Relative to {first_genome} (first-listed genome; see note above).",
        "",
        "**Per-genome inverted proportion:**\n",
        "| Genome | Inverted Length | % of Syntenic Length Inverted |", 
        "|---|---|---|"
    ]
    for row in inv_per_genome:
        pct = "N/A" if row["pct_inverted"] is None else f"{row['pct_inverted']}%"
        lines.append(f"| {row['genome']} | {row['inverted_length']} | {pct} |")

    lines.extend(
        ["",
         f"**Largest individual inversions (top {len(inv_top)}):**\n",
         "| Genome | Chromosome | Location | Length |",
         "|---|---|---|---|",
         ]
        )
    for row in inv_top:
        lines.append(f"| {row.genome} | {row.chrom} | {row.start}-{row.end} | {row.end - row.start} |")
    lines.append("")

    return lines

def build_companion_image(image_path):
    """Build companion image section"""
    lines = [
        "## Companion Image (optional)",
        "",
    ]

    if image_path:
        lines.append(f"`{image_path}`")
    else:
        lines.append("Not provided.")

    lines.extend([
        "",
        """
If available, provide this alongside the markdown file to a
vision-capable LLM for an additional, purely qualitative visual
impression -- it is not required to produce a valid summary.
        """,
        "",
    ])

    return lines


def build_markdown(genome_order, norm_summary, chrom_results, inv_per_genome,
    inv_top, first_genome, image_path=None,):
    """Build the markdown file"""
    sections = [
        build_header(),
        [LLM_INSTRUCTIONS],
        build_about_section(first_genome),
        build_genome_table(genome_order, norm_summary),
        build_chromosome_table(chrom_results),
        build_inversion_table(inv_per_genome, inv_top, first_genome),
        build_companion_image(image_path),
    ]

    lines = []

    for section in sections:
        lines.extend(section)

    return "\n".join(lines)


def main():
    """Generate a LLM markdown file for the ntSynt-viz ribbon plot"""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("synteny_tsv")
    parser.add_argument("--normalize", 
                        help="Path to normalization TSV (optional; "
                        "only needed if chromosomes were reverse-complemented during normalization)")
    parser.add_argument("-o", "--output", default="ribbon_plot_summary_context.md")
    parser.add_argument("--image", default=None, help="Path to companion PNG/PDF")
    parser.add_argument("--top-n", type=int, default=5)
    parser.add_argument("--lengths", type=str, required=True,
                        help="Path to TSV with headers bin_id,seq_id,length,relative_orientation")
    args = parser.parse_args()

    rows = load_synteny_tsv(args.synteny_tsv)
    norm_rows = []
    if args.normalize:
        norm_rows = load_normalization_tsv(args.normalize)
    genome_order = get_genome_order(rows)
    norm_summary = normalization_summary(norm_rows)
    chrom_lengths = read_lengths_tsv(args.lengths)

    chrom_results = chromosome_correspondence(rows, genome_order, chrom_lengths)
    inv_per_genome, inv_top, first_genome = inversion_summary(rows, genome_order, top_n=args.top_n)

    md = build_markdown(genome_order, norm_summary, chrom_results,
                         inv_per_genome, inv_top, first_genome, image_path=args.image)

    Path(args.output).write_text(md, encoding="utf-8")
    print(f"Wrote {args.output}")


if __name__ == "__main__":
    main()
