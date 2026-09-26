#!/bin/bash
# node:process / process / cloudflare:workers から env を取り出す import を、改行をまたいで探す（file:line: を出す）。
# 1 行の grep だけだと、oxfmt が printWidth を超える import を 1 名前 1 行に折り返した形
# （import {\n  argv,\n  env,\n} from "node:process"）と、default / namespace の import（import nodeProcess from
# "node:process" → nodeProcess.env）を見逃す。arch-guards-lib.sh の process.env のガードと api-process-env.sh が使う。
# 使い方: env-import-scan.sh <ファイル>...（ファイルが無ければ何も出さない）
set -uo pipefail
[ "$#" -eq 0 ] && exit 0
# cloudflare:workers の DurableObject 等、env を含まない名前付き import は止めない
exec perl -0777 -ne '
  while (/import\s+(?:type\s+)?(?:\{[^}]*\benv\b[^}]*\}|\*\s*as\s+[\w\$]+|[\w\$]+(?:\s*,\s*(?:\{[^}]*\}|\*\s*as\s+[\w\$]+))?)\s*from\s*["\x27](?:node:process|process|cloudflare:workers)["\x27]/g) {
    my $line = (substr($_, 0, $-[0]) =~ tr/\n//) + 1;
    my $text = $&;
    $text =~ s/\s+/ /g;
    print "$ARGV:$line:$text\n";
  }
' -- "$@"
