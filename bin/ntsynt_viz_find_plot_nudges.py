#!/usr/bin/env python3
'''
Given a file listing all assemblies, and another with any haplotypes in the same line, separated by tabs,
Output a TSV with the orders and nudges.
0: no nudge, no haplotype
- nudge: First in orders file of haplotypes
+ nudge: Second in orders of file of haplotypes
'''
import argparse
import sys

class AssemblyInfo:
    "Information about assembly in the orders file"

    def __init__(self, index):
        self._index = index
        self._nudge = 0

    @property
    def nudge(self):
        "Return the nudge property"
        return self._nudge

    @nudge.setter
    def nudge(self, nudge):
        "Set the nudge property"
        self._nudge = nudge

    @property
    def index(self):
        "Return the index property"
        return self._index

    @index.setter
    def index(self, index):
        "The index property shouldn't be changed after constructor"
        print(f"Warning - the index property {index} will not be changed", file=sys.stderr, flush=True)

def read_orders_file(orders_file):
    "Read the orders file, and return a dictionary where AssemblyInfo objects are the values"
    orders = {}
    line_index = 0
    with open(orders_file, 'r', encoding="utf-8") as fin:
        for line in fin:
            asm = line.strip()
            orders[asm] = AssemblyInfo(line_index)
            line_index += 1
    return orders

def make_haplotype_nudges(haplotypes_file, orders_dict, nudge):
    "Find haplotype nudges"
    with open(haplotypes_file, 'r', encoding="utf-8") as fin:
        for line in fin:
            hap1, hap2 = line.strip().split("\t")
            if hap1 not in orders_dict or hap2 not in orders_dict:
                print(f"Warning - one or both of {hap1}, {hap2} not found "
                      "- check your haplotypes TSV and name_conversions TSV files.",
                      file=sys.stderr, flush=True)
                continue
            index1, index2 = orders_dict[hap1].index, orders_dict[hap2].index
            if abs(index1 - index2) > 1:
                print(f"Warning - assembly {hap1} and {hap2} are not consecutive, will not be nudged",
                      file=sys.stderr, flush=True)
                continue
            if index1 < index2:
                orders_dict[hap1].nudge = -1*nudge
                orders_dict[hap2].nudge = nudge
            else:
                orders_dict[hap1].nudge = nudge
                orders_dict[hap2].nudge = -1*nudge

def main():
    "Output haplotype nudges"
    parser = argparse.ArgumentParser(description="Output haplotype-guided nudges for ribbon plots")
    parser.add_argument("--haplotypes", help="Haplotypes TSV", required=True, type=str)
    parser.add_argument("--orders", help="Orders TSV", required=True, type=str)
    parser.add_argument("--nudge", help="Size of nudge", default=0.1, type=float)

    args = parser.parse_args()

    orders_dict = read_orders_file(args.orders)

    make_haplotype_nudges(args.haplotypes, orders_dict, args.nudge)

    print("bin_id", "nudge", sep="\t")
    for asm, info in sorted(orders_dict.items(), key=lambda x: x[1].index):
        print(asm, info.nudge, sep="\t")

if __name__ == "__main__":
    main()
