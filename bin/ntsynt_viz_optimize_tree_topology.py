#!/usr/bin/env python3
"""
optimize_tree_topology.py

Given an ntSynt synteny blocks TSV and a Newick tree, find the tree rotation
that minimizes the total pairwise inversion length between adjacent genomes.

Outputs:
  - TSV: one genome name per line, in optimized top-to-bottom order
  - Newick: tree with subtrees rotated to match the optimal ordering
"""

import argparse
import io
import sys
from collections import defaultdict
from Bio import Phylo
from Bio.Phylo.BaseTree import Clade, Tree


# ---------------------------------------------------------------------------
# Column indices (0-based) for the synteny blocks TSV
# ---------------------------------------------------------------------------
COL_BLOCK_ID    = 0
COL_GENOME      = 1
COL_CHROM       = 2
COL_START       = 3
COL_END         = 4
COL_STRAND      = 5
COL_MINIMIZERS  = 6
COL_DISCONTINUITY = 7


def parse_args() -> argparse.Namespace:
    "Parse arguments"
    parser = argparse.ArgumentParser(
        description="Optimize phylogenetic tree rotation to minimize visible inversions "
                    "in ntSynt-viz ribbon plots."
    )
    parser.add_argument(
        "--blocks", required=True,
        help="ntSynt synteny blocks TSV file."
    )
    parser.add_argument(
        "--tree", required=True,
        help="Newick tree file. Leaf names must match genome file names in the blocks TSV."
    )
    parser.add_argument(
        "--out-order", required=True,
        help="Output TSV: one genome name per line, optimized top-to-bottom order."
    )
    parser.add_argument(
        "--out-tree", required=True,
        help="Output Newick file with subtrees rotated to match the optimal ordering."
    )
    parser.add_argument(
        "--target", default=None,
        help="If specified, this genome is always placed first (top-most) in the ordering."
    )
    return parser.parse_args()


# ---------------------------------------------------------------------------
# Biopython helpers
#
# ---------------------------------------------------------------------------

def _is_leaf(clade: Clade) -> bool:
    return clade.is_terminal()

def _get_children(clade: Clade) -> list[Clade]:
    return clade.clades

def _get_leaf_names(clade: Clade) -> list[str]:
    return [leaf.name for leaf in clade.get_terminals()]

def load_tree(newick_path: str) -> Tree:
    """
    Read a Newick tree with Biopython. If the tree is unrooted (or has a
    trifurcating/polytomous root, as is common from tools like RAxML/IQ-TREE),
    midpoint rooting is applied, which also resolves the root into a
    strictly bifurcating split.
    """
    with open(newick_path, 'r', encoding="utf-8") as fh:
        newick_str = fh.read().strip()

    tree = Phylo.read(io.StringIO(newick_str), "newick")

    if len(tree.root.clades) != 2:
        print(
            "  Tree root is not bifurcating (likely unrooted input); "
            "applying midpoint rooting.",
            file=sys.stderr,
        )
        tree.root_at_midpoint()

    if not tree.is_bifurcating():
        print("WARNING: --optimize-ordering option is not compatible with polytomies")

    return tree

# ---------------------------------------------------------------------------
# Step 1: Build pairwise inversion cost matrix
# ---------------------------------------------------------------------------

def _tally_block(
    entries: list[tuple[str, str, int]],
    cost: dict[tuple[str, str], int],
) -> None:
    """
    Given all rows for a single synteny block, tally inverted pairs
    directly into `cost`. Called once per block, then entries is discarded.
    """
    for i, el_i in enumerate(entries):
        for j in range(i + 1, len(entries)):
            genome_a, strand_a, length_a = el_i
            genome_b, strand_b, length_b = entries[j]
            if genome_a == genome_b:
                continue
            if strand_a != strand_b:
                inversion_length = (length_a + length_b) // 2
                cost[(genome_a, genome_b)] += inversion_length
                cost[(genome_b, genome_a)] += inversion_length


def build_cost_matrix(
    blocks_path: str,
) -> dict[tuple[str, str], int]:
    """
    Stream the ntSynt blocks TSV one block at a time, tallying the total
    length of inverted synteny blocks for each genome pair.

    Rows are assumed to be sorted by block ID (consecutive rows with the
    same ID belong to the same block). Only the current block's rows are
    held in memory at any point.

    Returns:
        cost[(genome_a, genome_b)] = total inverted block length (symmetric)
    """
    cost: dict[tuple[str, str], int] = defaultdict(int)
    current_block_id: str | None = None
    current_entries: list[tuple[str, str, int]] = []

    with open(blocks_path, 'r', encoding="utf-8") as fh:
        for line in fh:
            fields = line.strip().split("\t")
            block_id = fields[COL_BLOCK_ID]
            genome   = fields[COL_GENOME]
            start    = int(fields[COL_START])
            end      = int(fields[COL_END])
            strand   = fields[COL_STRAND]
            length   = abs(end - start)

            if block_id != current_block_id:
                if current_entries:
                    _tally_block(current_entries, cost)
                current_block_id = block_id
                current_entries = []

            current_entries.append((genome, strand, length))

        # Flush the final block
        if current_entries:
            _tally_block(current_entries, cost)

    return dict(cost)


def get_genomes_from_cost_matrix(
    cost: dict[tuple[str, str], int]
) -> list[str]:
    "Returns the genomes from the cost matrix"
    genomes: set[str] = set()
    for a, b in cost:
        genomes.add(a)
        genomes.add(b)
    return sorted(genomes)


# ---------------------------------------------------------------------------
# Step 2: Exhaustive memoized tree rotation optimization
# ---------------------------------------------------------------------------

# Each subtree result is a list of options:
#   (internal_cost, topmost_leaf, bottommost_leaf, ordering_tuple)
SubtreeOption = tuple[int, str, str, tuple[str, ...]]

def build_subtree_options(
    node: Clade,
    cost: dict[tuple[str, str], int],
    target_genome: str | None = None,
) -> list[SubtreeOption]:
    """
    Recursively compute all valid leaf orderings for the subtree rooted at
    `node`, memoizing results so each clade is computed exactly once.
 
    If target_genome is specified, any option where it would not appear as
    the top leaf is discarded at nodes whose subtree contains it.
 
    Returns a list of (total_internal_cost, top_leaf, bottom_leaf, ordering).
    """
    if _is_leaf(node):
        return [(0, node.name, node.name, (node.name,))]

    children = _get_children(node)
    if len(children) != 2:
        raise ValueError(
            f"Tree must be strictly bifurcating; node '{node.name}' "
            f"has {len(children)} children. The option --optimize-ordering is not compatible with polytomies."
        )

    top_options  = build_subtree_options(children[0], cost, target_genome)
    bottom_options = build_subtree_options(children[1], cost, target_genome)

    # Determine whether the target genome falls in the top or bottom subtree,
    # so we know which side must come first at this node.
    top_leaf_names  = set(_get_leaf_names(children[0]))
    bottom_leaf_names = set(_get_leaf_names(children[1]))
    target_in_top  = target_genome in top_leaf_names if target_genome else False
    target_in_bottom = target_genome in bottom_leaf_names if target_genome else False

    results: list[SubtreeOption] = []

    for top_cost, top_top, top_bottom, top_order in top_options:
        for bottom_cost, bottom_top, bottom_bottom, bottom_order in bottom_options:

            # Option A: [top subtree | bottom subtree]
            # Skip if target must be topmost but would not be.
            if not (target_in_bottom and not target_in_top):
                boundary_a = cost.get((top_bottom, bottom_top), 0)
                results.append((
                    top_cost + bottom_cost + boundary_a,
                    top_top,
                    bottom_bottom,
                    top_order + bottom_order,
                ))

            # Option B: [bottom subtree | top subtree]
            # Skip if target must be topmost but would not be.
            if not (target_in_top and not target_in_bottom):
                boundary_b = cost.get((bottom_bottom, top_top), 0)
                results.append((
                    top_cost + bottom_cost + boundary_b,
                    bottom_top,
                    top_bottom,
                    bottom_order + top_order,
                ))
    return results


def optimize_topology(
    newick_path: str,
    cost: dict[tuple[str, str], int],
    target_genome: str | None = None,
) -> tuple[list[str], int, Tree]:
    """
    Load the tree, run exhaustive memoized optimization, and return:
      - optimal genome ordering (list of names, top to bottom)
      - optimal total inversion cost
      - Biopython Tree object rotated to match the optimal ordering
 
    If target_genome is specified, it is guaranteed to be first in the ordering.
    The tree is midpoint-rooted if it is not already strictly bifurcating
    at the root (e.g. unrooted input).
    """
    tree = load_tree(newick_path)
    root = tree.root

    if target_genome is not None:
        leaf_names = set(_get_leaf_names(root))
        if target_genome not in leaf_names:
            raise ValueError(
                f"--target-genome '{target_genome}' not found in tree leaves: "
                f"{sorted(leaf_names)}"
            )

    options = build_subtree_options(root, cost, target_genome)
    best_cost, _, _, best_order_tuple = min(options, key=lambda x: int(x[0]))
    best_order = list(best_order_tuple)

    _rotate_tree_to_order(root, best_order)

    return best_order, best_cost, tree


def _rotate_tree_to_order(node: Clade, target_order: list[str]) -> None:
    """
    Rotate subtrees of `node` in-place so that the leaf order matches
    target_order (top-to-bottom).
    """
    if _is_leaf(node):
        return

    children = _get_children(node)
    top_leaves = set(_get_leaf_names(children[0]))

    # Find where the top child's leaves sit in target_order
    top_positions  = [i for i, g in enumerate(target_order) if g in top_leaves]
    bottom_positions = [i for i, g in enumerate(target_order) if g not in top_leaves]

    # If the top child's leaves all come after the bottom child's, swap
    if top_positions and bottom_positions and min(top_positions) > min(bottom_positions):
        node.clades[0], node.clades[1] = node.clades[1], node.clades[0]
        children = _get_children(node)

    for child in children:
        _rotate_tree_to_order(child, target_order)


# ---------------------------------------------------------------------------
# Step 3: Output
# ---------------------------------------------------------------------------

def write_order_tsv(order: list[str], out_path: str) -> None:
    "Write the optimized genome order to a TSV file, one genome per line."
    with open(out_path, "w", encoding="utf-8") as fh:
        for genome in order:
            fh.write(genome + "\n")


def write_newick(tree: Tree, out_path: str) -> None:
    "Write the rotated tree to a Newick file."
    # format=1 preserves internal node names if present
    Phylo.write(tree, out_path, "newick")



# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    "Parse arguments, build cost matrix, optimize tree topology, and write outputs."
    args = parse_args()

    # --- Build cost matrix ---
    print("Building pairwise inversion cost matrix...", file=sys.stderr)
    cost = build_cost_matrix(args.blocks)
    genomes = get_genomes_from_cost_matrix(cost)
    print(f"  Found {len(genomes)} genomes.", file=sys.stderr)

    if not cost:
        print(
            "Warning: no pairwise inversions found. All costs are zero; "
            "the original tree ordering will be preserved.",
            file=sys.stderr,
        )

    # --- Optimize ---
    print("Optimizing tree topology...", file=sys.stderr)
    if args.target:
        print(f"  Target genome (always first): {args.target}", file=sys.stderr)
    best_order, best_cost, rotated_tree = optimize_topology(
        args.tree, cost, target_genome=args.target
    )

    print(f"  Optimal total inversion cost: {best_cost:,} bp", file=sys.stderr)
    print("  Optimal ordering:", file=sys.stderr)
    for i, genome in enumerate(best_order):
        print(f"    {i + 1}. {genome}", file=sys.stderr)

    # --- Write outputs ---
    write_order_tsv(best_order, args.out_order)
    print(f"Order written to: {args.out_order}", file=sys.stderr)

    write_newick(rotated_tree, args.out_tree)
    print(f"Rotated tree written to: {args.out_tree}", file=sys.stderr)


if __name__ == "__main__":
    main()
