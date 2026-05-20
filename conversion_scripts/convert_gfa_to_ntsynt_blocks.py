#!/usr/bin/env python3
'''
Parses a pangenome GFA file and outputs a tab-delimited file in ntSynt-like format
'''
import sys
import shutil
import subprocess
import shlex
import argparse
import re
from collections import defaultdict, namedtuple
from datetime import datetime

# ----------------------------
# Data classes
# ----------------------------

Occurrence = namedtuple("Occurrence", ["assembly", "contig", "start", "end", "strand"])

class Segment:
    __slots__ = ('id', 'length', 'occurrences', "counts", "duplicate")
    "A segment in the GFA file"
    def __init__(self, seg_id, length):
        self.id = seg_id
        self.length = length
        self.occurrences = []              # list of Occurrence
        self.counts = {}     # assembly -> count

    def add_occurrence(self, occ):
        if occ.assembly not in self.counts:
            self.counts[occ.assembly] = 0
        self.counts[occ.assembly] += 1
        if self.counts[occ.assembly] == 1: # only add occurrence if it's the first time we see this assembly for this segment
            self.occurrences.append(occ)
        

    def assemblies_present(self):
        return set(self.counts.keys())

    def is_duplicate(self):
        return any(c > 1 for c in self.counts.values())
    
    def is_single_copy(self, total_assemblies):
        return (
            all(count == 1 for _, count in self.counts.items()) and
            len(self.counts.keys()) == total_assemblies
        )

    def get_occurrence(self, assembly):
        for occ in self.occurrences:
            if occ.assembly == assembly:
                return occ
        return None
    

def read_assembly_names_file(filename):
    "Read the assembly names file and return a mapping from (sample_id, haplotype) to assembly name"
    asm_map = {}
    with open(filename, 'r', encoding="utf-8") as f:
        for line in f:
            sample_id, haplotype, assembly_name = line.strip().split("\t")
            asm_map[(sample_id, haplotype)] = assembly_name
    return asm_map

def parse_segments(gfa_file, minlen):
    "Parse the S lines to get segment lengths and create Segment objects"
    segments = {} # dictionary: seg_ig -> int (segment length) | Segment
    
    print(f"{datetime.now()} Parsing segments from the GFA file...", file=sys.stderr)

    with open(gfa_file, 'r', encoding="utf-8") as f:
        for line in f:
            if not line.startswith("S"):
                continue

            fields = line.strip().split("\t")
            _, seg_id, seq = fields[:3]

            if seq != "*":
                length = len(seq)
            else:
                length = None
                for tag in fields[3:]:
                    if tag.startswith("LN:i:"):
                        length = int(tag.split(":")[2])
                        break

                if length is None:
                    raise ValueError(f"GFA is missing required length information for segment {seg_id}.\n"
                                     "Line which raised the issue: {line}.\nExiting..")

            if length >= minlen:
                segments[seg_id] = Segment(seg_id, length)
            else:
                segments[seg_id] = length

    return segments


def parse_walk(walk_str):
    "Parse a walk string into a list of (orientation, segment_id) tuples"
    tokens = re.findall(r'([<>])([^<>]+)', walk_str)

    reconstructed = ''.join(o + s for o, s in tokens)
    if reconstructed != walk_str:
        raise ValueError(f"Malformed walk: {walk_str}")

    return tokens

def parse_walks(gfa_file, segments, asm_name_conversions, minlen):
    "Parse the W lines to get segment occurrences in each assembly and contig"
    print(f"{datetime.now()} Parsing walks from the GFA file...", file=sys.stderr)
    assemblies = set()

    with open(gfa_file, 'r', encoding="utf-8") as f:
        for line in f:
            if not line.startswith("W"):
                continue

            fields = line.strip().split("\t")
            sample, hap, contig, start, _, walk = fields[1:7] 
            if (sample, hap) not in asm_name_conversions:
                raise ValueError(f"Assembly name for sample {sample} and haplotype {hap} "
                                 "not found in assembly names file.\n"
                                 "Exiting..")
            start = int(start)

            assembly = asm_name_conversions[(sample, hap)]
            assemblies.add(assembly)

            pos = start

            tokens = parse_walk(walk)

            for orient, seg_id in tokens:
                seg = segments[seg_id]
                length = seg if isinstance(seg, int) else seg.length

                seg_start = pos
                seg_end = pos + length

                strand = "+" if orient == ">" else "-"

                if length >= minlen:
                    occ = Occurrence(assembly, contig, seg_start, seg_end, strand)
                    seg.add_occurrence(occ)

                pos = seg_end

    return assemblies


def filter_segments(segments, assemblies):
    "Filter segments which are found in all assemblies and are single-copy in each"
    print(f"{datetime.now()} Filtering segments based on occurrences in walks...", file=sys.stderr)
    total = len(assemblies)

    filtered = [
        seg for seg in segments.values()
        if not isinstance(seg, int) and seg.is_single_copy(total)
    ]

    return filtered


def sort_segments(segments, assemblies):
    "Sort segments based on their order in the first assembly (lexicographically smallest)"
    print(f"{datetime.now()} Sorting segments...", file=sys.stderr)
    ref = sorted(assemblies)[0]
    
    segments = sorted(segments,
                      key=lambda seg: (seg.get_occurrence(ref).contig,
                                       seg.get_occurrence(ref).start))

    return segments


def output_ntsynt(segments, filename):
    "Output segments in ntSynt-like format (tab-delimited)"
    print(f"{datetime.now()} Printing unmerged ntSynt blocks to {filename}...", file=sys.stderr)
    with open(filename, 'w', encoding="utf-8") as f:
        for block_id, seg in enumerate(segments):
            for occ in seg.occurrences:
                f.write(
                    f"{block_id}\t{occ.assembly}\t{occ.contig}\t{occ.start}\t"
                    f"{occ.end}\t{occ.strand}\t0\tNone\n"
                )
            
def merge_collinear_blocks(ntsynt_filename, ntsynt_outfile, merge_dist, indel_threshold):
    "Merge collinear segments in all assemblies"
    print(f"{datetime.now()} Merging collinear blocks...", file=sys.stderr)
    
    cmd = f"ntsynt_merge_collinear.py --tsv {ntsynt_filename} --merge {merge_dist} --indel {indel_threshold}"
    result = subprocess.run(shlex.split(cmd), stdout=subprocess.PIPE, text=True, check=True)
    print(f"{datetime.now()} Writing merged ntSynt blocks to {ntsynt_outfile}...", file=sys.stderr)
    with open(ntsynt_outfile, "w") as f:
        f.write(result.stdout)


def parse_args():
    "Parse arguments"
    parser = argparse.ArgumentParser(description="Convert GFA to ntSynt-like format")
    parser.add_argument("--gfa", help="Input GFA file", required=True, type=str)
    parser.add_argument("--assembly-names", help="File associating sample ids and haplotypes from GFA to assembly names. "
                        "Format: sample_id\\thaplotype\\tassembly_name", required=True)
    parser.add_argument("--minlen", help="Minimum segment length to consider (default: 500)",
                        type=int, default=500)
    parser.add_argument("--no-merge-collinear", help="Do not merge collinear segments in all assemblies "
                        "(Default: merge collinear segments)",
                        action="store_true")
    parser.add_argument("--merge", help="Maximum distance between collinear synteny blocks for merging (default: 10000)",
                        type=int, default=10000)
    parser.add_argument("--indel", help="Threshold for indel detection (default: 10000)",
                        type=int, default=10000)
    parser.add_argument("--prefix", help="Prefix for output files (default: gfa-to-ntsynt)",
                        type=str, default="gfa-to-ntsynt")
    return parser.parse_args()

def main():
    args = parse_args()

    gfa = args.gfa
    
    # If merging collinear, check that the script is available on the PATH
    if not args.no_merge_collinear:
        if shutil.which("ntsynt_merge_collinear.py") is None:
            raise ValueError("The --merge-collinear option requires the ntsynt_merge_collinear.py script from ntSynt v1.0.7+"
                             "to be available on your PATH.\n"
                             "Please ensure it is installed and try again.\nExiting..")
    

    # Read assembly name conversions
    asm_map = read_assembly_names_file(args.assembly_names)

    # Parse segments from GFA
    segments = parse_segments(gfa, args.minlen)

    # Parse walks from GFA
    assemblies = parse_walks(gfa, segments, asm_map, args.minlen)

    # Filter segments based on occurences in walks
    segments = filter_segments(segments, assemblies)

    # Sorted segments
    segments = sort_segments(segments, assemblies)

    # Output ntSynt blocks
    unmerged_out_filename = f"{args.prefix}.non-merge-blocks.tsv"
    output_ntsynt(segments, unmerged_out_filename)
    
    # Merge collinear blocks (optional)
    if not args.no_merge_collinear:
        merged_out_filename = f"{args.prefix}.merged-blocks.tsv"
        segments = merge_collinear_blocks(unmerged_out_filename, merged_out_filename,
                                          args.merge, args.indel)


if __name__ == "__main__":
    main()
