#!/usr/bin/env bash
# shellcheck disable=SC2016 # the single-quoted strings are Perl programs
# Fails when text that must not be published appears in the repository: the patterns in
# .github/leak-patterns.txt, and the maintainers' private patterns in $LEAK_PATTERNS
# (newline-separated, from a secret; optional). Matches fully matched by an entry of
# .github/leak-allow.txt are ignored. See CONTRIBUTING.md, "Leak check".
#
#   .github/scripts/leak-check.sh                  # tracked files of the working tree
#   .github/scripts/leak-check.sh <base>..<head>   # also the lines those commits add, and their messages
#
# Hits print as file:line. A private pattern's hit never prints the pattern or the matched
# text, only its position in the list.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

RANGE="${1:-}"
PATTERNS_FILE=.github/leak-patterns.txt
ALLOW_FILE=.github/leak-allow.txt
# Not scanned: the lists themselves, and the lockfile (resolved versions and hashes only).
EXCLUDE=(":(exclude)$PATTERNS_FILE" ":(exclude)$ALLOW_FILE" ":(exclude)pnpm-lock.yaml")

entries() { grep -vE '^[[:space:]]*(#|$)' | sed 's/\r$//' || true; }

LEAK_PUBLIC="$(entries < "$PATTERNS_FILE")"
LEAK_PRIVATE="$(printf '%s\n' "${LEAK_PATTERNS:-}" | entries)"
LEAK_ALLOW="$(entries < "$ALLOW_FILE" | paste -sd'|' -)"
export LEAK_PUBLIC LEAK_PRIVATE LEAK_ALLOW

# Reports hits read from stdin as "<label>\t<file>\t<line>\t<match>", dropping allowed matches.
# Exits 1 when any hit is left.
report='
  my $allow = $ENV{LEAK_ALLOW} eq "" ? qr/(?!)/ : qr/^(?:$ENV{LEAK_ALLOW})$/;
  my $hits = 0;
  while (<STDIN>) {
    chomp;
    my ($label, $file, $line, $match) = split /\t/, $_, 4;
    next if $match =~ $allow;
    $hits++;
    my $what = $label =~ /^private/ ? $label : "$label: $match";
    print $line ? "$file:$line  $what\n" : "$file  $what\n";
    print "::error file=$file,line=$line\::Leak check: $label\n" if $ENV{GITHUB_ACTIONS} && $ENV{ANNOTATE};
  }
  exit($hits ? 1 : 0);
'

failed=0
count_public=$(printf '%s\n' "$LEAK_PUBLIC" | grep -c . || true)
count_private=$(printf '%s\n' "$LEAK_PRIVATE" | grep -c . || true)
echo "Leak check: $count_public public patterns, $count_private private patterns${RANGE:+, commits $RANGE}"

# Tracked files of the working tree, one git grep per pattern.
scan_tree() {
  local label="$1" pattern="$2" out status=0
  if [[ "$label" == private* ]]; then
    out="$(git grep -nIoP -e "$pattern" -- . "${EXCLUDE[@]}" 2>/dev/null)" || status=$?
  else
    out="$(git grep -nIoP -e "$pattern" -- . "${EXCLUDE[@]}")" || status=$?
  fi
  if [ "$status" -gt 1 ]; then
    echo "::error::Leak check: $label is not a valid Perl-compatible regular expression" >&2
    failed=1
    return
  fi
  [ -z "$out" ] && return
  # file:line:match (git grep -o prints one line per match).
  printf '%s\n' "$out" \
    | LABEL="$label" perl -ne 'chomp; /^(.*?):(\d+):(.*)$/ and print "$ENV{LABEL}\t$1\t$2\t$3\n"' \
    | ANNOTATE=1 perl -e "$report" || failed=1
}

while IFS= read -r pattern; do
  [ -n "$pattern" ] || continue
  scan_tree "public pattern '$pattern'" "$pattern"
done <<< "$LEAK_PUBLIC"
i=0
while IFS= read -r pattern; do
  [ -n "$pattern" ] || continue
  i=$((i + 1)); scan_tree "private pattern $i" "$pattern"
done <<< "$LEAK_PRIVATE"

# The commits of a pull request: the lines they add (a leak added and removed again stays in the
# history) and their messages.
if [ -n "$RANGE" ]; then
  scan_history='
    my (@pats, $bad);
    my $n = 0;
    sub add { my ($label, $source) = @_; my $re = eval { qr/$source/ };
      if ($re) { push @pats, [$label, $re] } else { print STDERR "::error::Leak check: $label is not a valid regular expression\n"; $bad = 1 } }
    for (split /\n/, $ENV{LEAK_PUBLIC}) { add("public pattern '\''$_'\''", $_) if length }
    for (split /\n/, $ENV{LEAK_PRIVATE}) { next unless length; $n++; add("private pattern $n", $_) }
    my ($commit, $file, $line, $in_message) = ("", "", 0, 0);
    while (<STDIN>) {
      chomp;
      if (/^\x01(\w+)/) { $commit = $1; $in_message = 1; next }
      if (/^\x02$/) { $in_message = 0; next }
      my $text;
      my $where;
      if ($in_message) { $text = $_; $where = "commit $commit (message)\t0" }
      elsif (/^\+\+\+ (?:b\/(.*)|\/dev\/null)$/) { $file = $1 // ""; next }
      elsif (/^@@ -\S+ \+(\d+)/) { $line = $1; next }
      elsif (/^\+(.*)$/ && $file ne "") { $text = $1; $where = "$file (commit $commit)\t$line"; $line++ }
      else { next }
      for my $p (@pats) {
        while ($text =~ /$p->[1]/g) { print "$p->[0]\t$where\t$&\n"; last if length($&) == 0 }
      }
    }
    exit($bad ? 2 : 0);
  '
  {
    git log --format='%x01%h%n%B%x02' "$RANGE"
    git log -p -U0 --no-merges --no-color --no-ext-diff --format='%x01%h%n%x02' "$RANGE" -- . "${EXCLUDE[@]}"
  } | perl -e "$scan_history" | perl -e "$report" || failed=1
fi

if [ "$failed" -ne 0 ]; then
  echo "Leak check failed. Remove the text above (rewrite the commit if it is in a pull request's history)," >&2
  echo "or, if it is not a leak, see CONTRIBUTING.md, \"Leak check\"." >&2
  exit 1
fi
echo "Leak check passed."
