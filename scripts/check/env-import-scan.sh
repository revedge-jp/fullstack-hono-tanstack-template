#!/bin/bash
# node:process / process / cloudflare:workers から env を取り出す import を、改行をまたいで探す（file:line: を出す）。
# 1 行の grep だけだと、oxfmt が printWidth を超える import を 1 名前 1 行に折り返した形
# （import {\n  argv,\n  env,\n} from "node:process"）と、default / namespace の import（import nodeProcess from
# "node:process" → nodeProcess.env）を見逃す。arch-guards-lib.sh の process.env のガードと api-process-env.sh が使う。
# 使い方: env-import-scan.sh <ファイル>...（ファイルが無ければ何も出さない）
set -uo pipefail
[ "$#" -eq 0 ] && exit 0
# cloudflare:workers の DurableObject 等、env を含まない名前付き import は止めない
# default / namespace で束縛した名前（import nodeProcess from / import * as p from / import { default as p } from）は、
# 同じファイルに <名前>.env があるときだけ違反にする（process.exit のためだけの import は止めない）
exec perl -0777 -ne '
  my $src = $_;
  # コメントの中の env を数えない（波括弧の中のコメント等）。行番号を保つため改行は残す
  (my $code = $src) =~ s{/\*.*?\*/}{ (my $c = $&) =~ s/[^\n]//g; $c }gse;
  $code =~ s{//[^\n]*}{}g;
  my $modules = q{["\x27](?:node:process|process|cloudflare:workers)["\x27]};
  while ($code =~ /import\s+(?:type\s+)?(\{[^}]*\}|\*\s*as\s+[\w\$]+|[\w\$]+(?:\s*,\s*(?:\{[^}]*\}|\*\s*as\s+[\w\$]+))?)\s*from\s*$modules/g) {
    my ($clause, $start, $text) = ($1, $-[0], $&);
    my @bound;
    push @bound, $1 while $clause =~ /(?:^|,)\s*([\w\$]+)\s*(?=,|$)/g;
    push @bound, $1 while $clause =~ /\*\s*as\s+([\w\$]+)/g;
    push @bound, $1 while $clause =~ /\bdefault\s+as\s+([\w\$]+)/g;
    my $named_env = $clause =~ /\{[^}]*\benv\b/;
    my $bound_env = grep { my $n = quotemeta $_; $code =~ /(?<![\w\$.])$n\s*(?:\.\s*env\b|\[\s*["\x27]env)/ } @bound;
    next unless $named_env || $bound_env;
    my $line = (substr($code, 0, $start) =~ tr/\n//) + 1;
    $text =~ s/\s+/ /g;
    print "$ARGV:$line:$text\n";
  }
' -- "$@"
