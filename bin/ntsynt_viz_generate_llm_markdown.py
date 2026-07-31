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
overall structural trends: the overall degree of synteny coverage/density
(how much of each genome is captured in synteny blocks); whether the blocks that are present
are largely collinear or show substantial structural rearrangement; any
notable large-scale fusions/fissions and which genomes are involved; and (optionally)
any standout individual inversions or genomes with a disproportionate
share of inversion relative to the others.

Coverage/density and collinearity are two separate, both-reportable
questions -- do not let one substitute for the other. A set of genomes
can have blocks that stay in consistent order (collinear) while still
covering only a small, fragmented fraction of each chromosome's length
(low coverage), or vice versa. If coverage is low, sparse, or highly
variable across genomes, state this explicitly as a primary trend --
do not omit it in favor of describing rearrangement/order alone.

#### Synteny coverage / density description rules
Use the coverage table below (per-genome total syntenic length vs.
assembly length vs. % covered) to ground any statement about coverage.
Describe the overall pattern (e.g., coverage is low/high across most
genomes, or coverage varies substantially by genome/clade) rather than
listing each genome's percentage. Only call out an individual genome's
coverage figure if it stands out as a clear outlier from the rest.

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
Write the summary as a direct visual description of the companion image --
coverage/density, overall complexity, and any specific fusions, fissions,
or inversions should be described as things seen in the plot, not as
things reported in a table.
The whole image should be considered, not just the top genome or a single chromosome.

When assessing coverage/density visually, note whether ribbons run
near-continuously along the full length of each chromosome bar (high
coverage) or appear as thin, scattered segments separated by substantial
uncolored/gray gaps (low coverage). This is a distinct, reportable
feature in its own right, separate from whether ribbons cross
(inversion) or split (fusion/fission) -- a plot can show clean,
uncrossed ribbons that still cover only a small fraction of each bar,
and that sparseness should be described rather than treated as
"collinear" or left unmentioned.

Use the tables only silently, in the background, to:
- confirm that a visual feature (including apparent low coverage) is
  genuine and not a rendering artifact,
- obtain the correct chromosome/accession identifiers to name it,
- decide whether an event is large enough to be worth describing.

Never reference the tables, the markdown file, or the act of cross-referencing
in the output. Do not use phrases like "consistent with," "table-derived,"
"the data shows," or similar meta-commentary -- state observations directly
(e.g., "Chromosome 8 shows an inversion in Han1..." not "the table confirms
an inversion consistent with...").

If a genuine event documented in the tables is too small to be discernible in
the image at this scale, omit it from the summary rather than describing an
invisible feature -- unless it is among the most significant events overall,
in which case describe it in general terms (e.g., "a smaller-scale inversion
is also present on...") without claiming it's visible.

If something appears visually prominent in the image, verify it against the
tables before naming a specific chromosome/accession, but write the
conclusion as a plain visual observation.


#### Multi-genome framing 
Remember that the comparisons are multi-genome, meaning that every synteny
block contains coordinates from each genome -- there is no concept of
separate pairwise comparisons when interpreting the plot.
In addition, the synteny blocks were generated using 
an alignment-free approach, so always avoid any mention of 
alignments (aligned, unaligned, etc.).

#### Reverse-complementation arrows are not structural variation
Arrows under a chromosome are already explained in the image legend.
Do not mention arrows in the summary at all -- not their presence,
count, density, distribution, which genomes or chromosomes show them,
or what they mean. Never use arrow count or frequency as evidence of
structural variation, rearrangement, or any difference in genome
quality/complexity between genomes, and never compare genomes' arrow
patterns against each other, even indirectly (e.g., "several
chromosomes required reorientation in X" is still off-limits).
Arrows are a rendering/orientation detail for the reader to consult
the legend on, not a summary-worthy feature.

#### Phylogenetic tree rules
If a phylogenetic tree is provided, derive all statements about which
genomes are \"closely related,\" \"sister taxa,\" etc. strictly from the tree
topology -- never from the structural consistency or correspondence tables.
Use the tables only to say whether structural patterns are consistent or
inconsistent with the tree relationships, not to define them.

#### General language rules
Avoid non-scientific, unfalsifiable, or aesthetic language throughout,
including superlatives (exceptional, amazing, remarkable) and subjective
visual descriptors (modest, striking, subtle, understated, overwhelming).

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


def coverage_summary(rows, chrom_lengths, genome_order):
    """Per-genome total syntenic length (bp of that genome's own
    chromosomes covered by at least one synteny block) vs. that genome's
    total assembly length, expressed as a % covered.

    This is distinct from the chromosome correspondence table: it answers
    "how much of this genome is in a synteny block at all," not "how do
    two genomes' chromosomes map onto each other."
    """
    syntenic_totals = defaultdict(int)
    for r in rows:
        syntenic_totals[r.genome] += (r.end - r.start)

    results = []
    for genome in genome_order:
        assembly_length = sum(chrom_lengths.get(genome, {}).values())
        syntenic_length = syntenic_totals.get(genome, 0)
        pct = (
            round(100 * syntenic_length / assembly_length, 1)
            if assembly_length > 0 else None
        )
        results.append({
            "genome": genome,
            "assembly_length": assembly_length,
            "syntenic_length": syntenic_length,
            "pct_covered": pct,
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
        "This file is generated by the ntSynt-viz pipeline to accompany a ribbon plot.",
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
block** is a genomic region conserved between genomes; **coverage/
density** refers to what fraction of a genome's total length is
captured in synteny blocks at all, independent of block order; an
**inversion** is a block in reversed orientation relative to
{first_genome}, the first-listed genome (chosen only for its position
in the input order, not as a biological reference); a **fusion/
fission** is a case where regions from one chromosome in one genome
correspond to multiple chromosomes in another.

If a companion image is provided: each chromosome in the top genome is assigned a distinct
color; ribbon width corresponds to syntenic block length; a
twisted/crossed ribbon indicates an inverted block; uncolored/gray
regions of a chromosome bar are not captured in any synteny block;
genomes are arranged in the order listed below.
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


def build_coverage_table(coverage_results):
    """Build synteny coverage/density table for markdown"""
    lines = [
        "## Synteny Coverage Summary",
        "",
        "Per-genome total length captured in synteny blocks, relative to "
        "assembly length. Distinct from the chromosome correspondence "
        "table below: this measures how much of each genome participates "
        "in any synteny block at all, not how chromosomes map onto each "
        "other.",
        "",
        "| Genome | Assembly Length | Total Syntenic Length | % Covered |",
        "|---|---|---|---|",
    ]

    for row in coverage_results:
        pct = "N/A" if row["pct_covered"] is None else f"{row['pct_covered']}%"
        lines.append(
            f"| {row['genome']} | "
            f"{row['assembly_length']} | "
            f"{row['syntenic_length']} | "
            f"{pct} |"
        )

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


def build_markdown(genome_order, norm_summary, coverage_results, chrom_results,
    inv_per_genome, inv_top, first_genome, image_path=None,):
    """Build the markdown file"""
    sections = [
        build_header(),
        [LLM_INSTRUCTIONS],
        build_about_section(first_genome),
        build_coverage_table(coverage_results),
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
    coverage_results = coverage_summary(rows, chrom_lengths, genome_order)
    inv_per_genome, inv_top, first_genome = inversion_summary(rows, genome_order, top_n=args.top_n)

    md = build_markdown(genome_order, norm_summary, coverage_results, chrom_results,
                         inv_per_genome, inv_top, first_genome, image_path=args.image)

    Path(args.output).write_text(md, encoding="utf-8")
    print(f"Wrote {args.output}")


if __name__ == "__main__":
    main()
