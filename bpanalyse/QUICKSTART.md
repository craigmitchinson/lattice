# Quick start

Step-by-step for someone who has never run a Python tool. Nothing here sends anything anywhere; the tool runs on your machine only.

## Mac

1. Open Terminal (Cmd+Space, type Terminal, Enter).

2. Get the code. First time:

       cd ~
       git clone https://github.com/craigmitchinson/lattice.git

   Already have it:

       cd ~/lattice
       git fetch

3. Switch to the branch:

       cd ~/lattice
       git checkout claude/clever-gates-ir1cir
       git pull

4. Set up Python inside the tool folder:

       cd bpanalyse
       python3 -m venv .venv
       source .venv/bin/activate
       pip install -e ".[test]"

   If `python3` offers to install developer tools, accept, wait, rerun the line. If Python is missing entirely, install 3.11 or later from python.org and rerun.

5. Check it works before using real files:

       python -m pytest -q

   The last line should end with `passed`.

6. Make two folders outside the repository and put your release files in the first:

       mkdir -p ~/bp-releases ~/bp-output
       open ~/bp-releases

   Drag your `.bprelease` files into the Finder window.

7. Run:

       python -m bpanalyse run ~/bp-releases ~/bp-output
       python -m bpanalyse discover ~/bp-releases ~/bp-output/census.txt
       open ~/bp-output

8. `run.log` and `census.txt` in the output folder contain names and counts only and are safe to share for diagnosis. The spreadsheets contain masked estate content; treat them as internal.

Next time: `cd ~/lattice/bpanalyse`, `source .venv/bin/activate`, then step 7.

## Windows

Same steps in PowerShell with these substitutions:

- Step 4: `py -m venv .venv` and `.venv\Scripts\activate`
- Step 6: `mkdir C:\bp-releases, C:\bp-output` and `explorer C:\bp-releases`
- Step 7: `C:\bp-releases C:\bp-output` and `explorer C:\bp-output`

Install Python 3.11 or later from python.org with "Add Python to PATH" ticked if `py` is not found.

## If something goes wrong

Copy the whole terminal output, including the command you ran. Exit code 2 means one file could not be parsed and `run.log` names it. Exit code 1 is a usage or setup error and the message says which.
