#!/usr/bin/env python3
'''
Use synteny block mappings to sort the sequences in the assemblies
'''
import sys
import argparse
import itertools
from collections import namedtuple, defaultdict
import intervaltree

SyntenyBlock = namedtuple("SyntenyBlock", ["id", "genome", "chrom", "start", "end", "strand", "num_mx", "reason"])
MapRegion = namedtuple("MapRegion", ["chrom", "start", "end"])

def insert_interval_tree(tree, blocks) -> None:
    "Insert block info into the intervaltree"
    for block_target, block_next in zip(blocks, blocks[1:]):
        if block_target.genome not in tree:
            tree[block_target.genome] = {}
        if block_target.chrom not in tree[block_target.genome]:
            tree[block_target.genome][block_target.chrom] = intervaltree.IntervalTree()
        block_data = MapRegion(block_next.chrom, int(block_next.start), int(block_next.end))
        tree[block_target.genome][block_target.chrom][int(block_target.start): int(block_target.end)] = block_data


def load_synteny_blocks(blocks_file):
    "Load the synteny blocks into an interval tree"
    blocks_tree = {}

    cur_block_id = None
    synteny_blocks = []
    with open(blocks_file, 'r', encoding="utf-8") as fin:
        for line in fin:
            block = SyntenyBlock(*line.strip().split("\t"))
            if block.id != cur_block_id:
                if cur_block_id is not None:
                    # At the next block. insert info into intervaltree
                    insert_interval_tree(blocks_tree, synteny_blocks)
                # Reset variables
                cur_block_id = block.id
                synteny_blocks = []
            synteny_blocks.append(block)

    # Don't forget last one
    if cur_block_id is not None:
        # At the next block. insert info into intervaltree
        insert_interval_tree(blocks_tree, synteny_blocks)
    asm_orders = [block.genome for block in synteny_blocks]

    return blocks_tree, asm_orders

def get_overlap_length(interval_hit, start, end):
    "Given the interval hit region with start/end coordinates, and the start/end of the tile, return the overlap length"
    overlap_len = min(interval_hit.end, end) - max(interval_hit.begin, start)
    return overlap_len

def tally_chromosome_hits(tree, asm, chrom, length, tile):
    "Tally chromosome hits per assembly"
    tiles = []
    for start in range(0, length, tile):
        asm_tallies = defaultdict(defaultdict) # chrom -> length
        end = min(start + tile, length)
        if chrom not in tree[asm]:
            continue
        for interval_hit in tree[asm][chrom][start: end]:
            map_region = interval_hit.data
            if map_region.chrom not in asm_tallies:
                asm_tallies[map_region.chrom] = 0
            asm_tallies[map_region.chrom] += get_overlap_length(interval_hit, start, end)
        if asm_tallies:
            best_hit_chrom, best_hit_length = sorted(list(asm_tallies.items()),
                                                    key=lambda x: x[1],
                                                    reverse=True)[0]

            tiles.append((best_hit_chrom, best_hit_length))
    return tiles

def get_chrom_orders(tile_list):
    "Given the tile list for a given assembly, return the chromosome orders"  
    collapsed_list = []
    for chrom, group in itertools.groupby(tile_list, key=lambda x: x[0]):
        total = sum(c[1] for c in group)
        collapsed_list.append((chrom, total))
    max_indexes = {} # chrom -> (max_index, max_val)
    for i, tup in enumerate(collapsed_list):
        chrom, length = tup
        if chrom not in max_indexes or length > max_indexes[chrom][1]:
            max_indexes[chrom] = (i, length)
    seq_order = [tile_tup[0] for i, tile_tup in enumerate(collapsed_list) if max_indexes[tile_tup[0]][0] == i]
    seq_order = {chrom: i for i, chrom in enumerate(seq_order)}
    return seq_order

def get_mapped_tiles(tree, fai_filenames, tile, asm_orders):
    "Get an ordered list of chrom, length per assembly using tiles over the target"
    all_asm_seq_orders = {} # asm -> chrom -> index
    fai_num = 0
    for fai_filename in fai_filenames:
        if fai_num >= len(asm_orders) - 1:
            break
        asm_base, asm_target = asm_orders[fai_num], asm_orders[fai_num + 1]
        tiles = [] # [list of chromosome hits]
        stored_fai_lines = []
        with open(fai_filename, 'r', encoding="utf-8") as fin:
            for line in fin:
                chrom, length = line.strip().split("\t")[:2]
                length = int(length)
                stored_fai_lines.append((chrom, length))
                if asm_base in all_asm_seq_orders and chrom not in all_asm_seq_orders[asm_base]:
                    all_asm_seq_orders[asm_base][chrom] = len(all_asm_seq_orders[asm_base])
        if asm_base in all_asm_seq_orders:
            stored_fai_lines = sorted(stored_fai_lines, key=lambda x: all_asm_seq_orders[asm_base][x[0]]) # pylint: disable=cell-var-from-loop
        for chrom, length in stored_fai_lines:
            tiles += tally_chromosome_hits(tree, asm_base, chrom, length, tile)

        all_asm_seq_orders[asm_target] = get_chrom_orders(tiles)
        fai_num += 1

    return all_asm_seq_orders

def get_target_genome_seqs(fai_filename, min_length):
    "Create dictionary with key sequence name, and value index in the input file"
    target_genome_seqs = {}
    i = 0
    with open(fai_filename, 'r', encoding="utf-8") as fin:
        for line in fin:
            line = line.strip().split("\t")
            seq_id, length = line[0], int(line[1])
            if length >= min_length:
                target_genome_seqs[seq_id] = i
                i += 1
    return target_genome_seqs

def update_orders_with_user_input(order_filename, asm_seq_orders, target_genome_dict, target_genome):
    """
    Update the chromosome orders data structure using the TSV file provided by the user.
    It may include orders for 1 or more genomes - ensure that it is complete (ie. includes all chromosomes expected)
    """
    input_orders = defaultdict(dict)
    with open(order_filename, 'r', encoding="utf-8") as fin:
        for line in fin:
            line = line.strip().split("\t")
            genome, ordered_chroms = line[0], line[1].split(" ")
            input_orders = {chrom: i for i, chrom in enumerate(ordered_chroms)}

            # Consistency checking
            if genome not in asm_seq_orders and genome != target_genome:
                print(f"ERROR: Unexpected genome name {genome}. "
                      f"Expected names: {asm_seq_orders.keys() | {target_genome}}\n"
                      f"Please check that the genome matches either the genome assembly"
                      f" file name or the name conversion",
                      file=sys.stderr)
                sys.exit(1)
            if genome != target_genome:
                for chrom in asm_seq_orders[genome]:
                    if chrom not in input_orders:
                        print(f"ERROR: {chrom} was expected, but not found in input orders file {order_filename}.")
                        sys.exit(1)
            else:
                for chrom in target_genome_dict:
                    if chrom not in input_orders:
                        print(f"ERROR: {chrom} was expected, but not found in input orders file {order_filename}.")
                        sys.exit(1)
            if genome == target_genome:
                target_genome_dict = input_orders
            else:
                asm_seq_orders[genome] = input_orders
    return target_genome_dict


def main():
    "Sort the sequences based on tiles on the target assembly"
    parser = argparse.ArgumentParser(description="Sort chromosomes based on tiles in target assembly")
    parser.add_argument("--fais", help="FAI files for assemblies, in same sort order as --blocks", required=True,
                        type=str, nargs="+")
    parser.add_argument("--blocks", help="Synteny blocks TSV - sorted by order for ribbon plots (if applicable)",
                        required=True, type=str)
    parser.add_argument("--tile", help="Tile size in bp [1 Mbp]", default=1000000, type=int)
    parser.add_argument("--lengths", help="Sequences lengths gggenomes TSV", required=True, type=str)
    parser.add_argument("--min-length", help="Minimum sequence length", type=int, default=100000)
    parser.add_argument("--chrom-order", help="User-specified TSV with chromosome orders for one or more assemblies"
                                            "Expected format: assembly_name\tspace-separated list of chromosomes")
    parser.add_argument("--prefix", help="Output file prefix", required=True, type=str)

    args = parser.parse_args()

    blocks_tree, asm_orders = load_synteny_blocks(args.blocks)

    asm_seq_orders = get_mapped_tiles(blocks_tree, args.fais, args.tile, asm_orders)

    target_genome_seqs = get_target_genome_seqs(args.fais[0], args.min_length)

    if args.chrom_order:
        target_genome_seqs = update_orders_with_user_input(args.chrom_order, asm_seq_orders,
                                                           target_genome_seqs, asm_orders[0])

    with open(args.lengths, 'r', encoding='utf-8') as fin, \
         open(f"{args.prefix}.sequence_lengths.sorted.tsv", 'w', encoding="utf-8") as output_lengths_gggenome, \
         open(f"{args.prefix}.target_colours.tsv", 'w', encoding="utf-8") as output_colour_indices:
        stored_lines = defaultdict(list) # asm -> stored_lines
        stored_target_lines = []
        for line in fin:
            asm_name, chrom, length, relative_ori = line.strip().split("\t")
            if asm_name == "bin_id":
                output_lengths_gggenome.write(line)
                output_colour_indices.write("chrom\tcolour_index\tnum_seqs\n")
            else:
                if asm_name == asm_orders[0]:
                    stored_target_lines.append((asm_name, chrom, length, relative_ori))
                else:
                    stored_lines[asm_name].append((asm_name, chrom, length, relative_ori))
                    if chrom not in asm_seq_orders[asm_name]:
                        asm_seq_orders[asm_name][chrom] = len(asm_seq_orders[asm_name])

        for line in sorted(stored_target_lines, key=lambda x: target_genome_seqs[x[1]]):
            chrom = line[1]
            output_lengths_gggenome.write("\t".join(line) + "\n")
            output_colour_indices.write(f"{chrom}\t{target_genome_seqs[chrom] + 1}\t{len(target_genome_seqs)}\n")


        for asm, lines_list in stored_lines.items():
            asm_orders_asm = asm_seq_orders[asm]
            for line in sorted(lines_list, key=lambda x: asm_orders_asm[x[1]]): # pylint: disable=cell-var-from-loop
                output_lengths_gggenome.write("\t".join(line) + "\n")



if __name__ == "__main__":
    main()
