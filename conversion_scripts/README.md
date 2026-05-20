# ntSynt-viz conversion scripts

Here, we provide scripts that can be used to convert synteny blocks from tools other than ntSynt to the format expected by ntSynt-viz. 

## Pangenome graphs
Synteny information can be parsed from pangenome graphs in GFA format and visualized using ntSynt-viz. This enables intuitive exploration of large-scale multi-genome synteny and structural variation encoded in pangenome graphs — patterns that are often obscured when inspecting the large graph directly. The input GFA file must include "Walks", which encode the traversal path of each chromosome through the graph and are required to determine segment coordinates.

To adhere to ntSynt criteria, here are the steps in parsing the synteny from the pangenome graph:
1. **Identify synteny block segments** — Segments present (1) in single copy and (2) found in every assembly are selected; these define the synteny blocks
2. **Determine coordinates** — For each synteny block, chromosomal coordinates in each assembly are calculated by parsing offsets from the GFA Walks
3. **Merge collinear blocks (optional)** — Collinear synteny blocks can be merged to produce cleaner, easier-to-interpret visualizations

ntSynt-viz can directly visualize the formatted synteny blocks produced by the `convert_gfa_to_ntsynt_blocks.py` script.

```
usage: convert_gfa_to_ntsynt_blocks.py [-h] --gfa GFA --assembly-names ASSEMBLY_NAMES [--minlen MINLEN] [--no-merge-collinear] [--merge MERGE] [--indel INDEL]
                                       [--prefix PREFIX]

Convert GFA to ntSynt-like format

optional arguments:
  -h, --help            show this help message and exit
  --gfa GFA             Input GFA file
  --assembly-names ASSEMBLY_NAMES
                        File associating sample ids and haplotypes from GFA to assembly names. Format: sample_id\thaplotype\tassembly_name
  --minlen MINLEN       Minimum segment length to consider (default: 500)
  --no-merge-collinear  Do not merge collinear segments in all assemblies (Default: merge collinear segments)
  --merge MERGE         Maximum distance between collinear synteny blocks for merging (default: 10000)
  --indel INDEL         Threshold for indel detection (default: 10000)
  --prefix PREFIX       Prefix for output files (default: gfa-to-ntsynt)
```

## Converting synteny blocks from SyRI

```
usage: convert_syri_to_ntsynt_blocks.py [-h] --query QUERY --target TARGET [-b MIN_SIZE] SYRI

Convert SyRI-formatted synteny blocks to ntSynt format

positional arguments:
  SYRI                  SyRI-formatted blocks (syri.out)

optional arguments:
  -h, --help            show this help message and exit
  --query QUERY         Query assembly name
  --target TARGET       Reference assembly file name
  -b MIN_SIZE, --min_size MIN_SIZE
                        Minimum block size (bp)
```

## Converting synteny blocks from halSynteny
```
usage: convert_halsynteny_to_ntsynt_blocks.py [-h] --query QUERY --target TARGET [--convert CONVERT] PSL

Convert the halSynteny PSL synteny block output to ntSynt format

positional arguments:
  PSL                PSL input file to convert

optional arguments:
  -h, --help         show this help message and exit
  --query QUERY      File name of query (earlier column in PSL file)
  --target TARGET    File name of target
  --convert CONVERT  TSV file to convert the chromosome names. 3 column format: assembly, current name, new name
```