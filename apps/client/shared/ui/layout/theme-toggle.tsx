import { useEffect, useSyncExternalStore } from "react";

type Theme = "light" | "dark" | "system";

function isTheme(value: string): value is Theme {
  return value === "light" || value === "dark" || value === "system";
}

// class ベースのダークモード（globals.css の `.dark` パレット / tailwind-config の
// `@custom-variant dark`）を documentElement に反映する。FOUC 回避の初期適用は
// __root.tsx の head インラインスクリプトが担い、このコンポーネントは切り替えのみ。
function applyTheme(theme: Theme) {
  const isDark =
    theme === "dark" ||
    (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  const el = document.documentElement;
  el.classList.toggle("dark", isDark);
  el.style.colorScheme = isDark ? "dark" : "light";
}

// localStorage はプライベートブラウズやストレージを無効にした設定で例外を投げる。保存できなくても
// 切り替え自体は効かせる（選んだテーマはこのタブの間だけ下の変数に残り、次に開いたときに system に戻る）
function readStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem("theme");
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system";
  }
}

function storeTheme(theme: Theme) {
  try {
    if (theme === "system") {
      localStorage.removeItem("theme");
    } else {
      localStorage.setItem("theme", theme);
    }
  } catch {
    // 保存できなくても表示の切り替えは続ける
  }
}

let preferredTheme: Theme | null = null;
const listeners = new Set<() => void>();

function getPreferredTheme(): Theme {
  if (preferredTheme === null) {
    preferredTheme = readStoredTheme();
  }
  return preferredTheme;
}

function subscribePreferredTheme(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function setPreferredTheme(theme: Theme) {
  preferredTheme = theme;
  storeTheme(theme);
  applyTheme(theme);
  for (const listener of listeners) {
    listener();
  }
}

export function ThemeToggle() {
  // SSR では localStorage を読めないので system として描き、ハイドレーション後に保存済みの設定へ切り替わる
  // （useSyncExternalStore の第3引数。effect で setState すると描画が二重になる）
  const theme = useSyncExternalStore(subscribePreferredTheme, getPreferredTheme, () => "system");

  // system 選択時は OS のテーマ変更に追従する。
  useEffect(() => {
    if (theme !== "system") {
      return;
    }
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyTheme("system");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);

  return (
    <div className="flex items-center gap-2">
      <label htmlFor="theme-select" className="text-sm text-muted-foreground">
        テーマ
      </label>
      <select
        id="theme-select"
        value={theme}
        onChange={(e) => {
          if (isTheme(e.target.value)) {
            setPreferredTheme(e.target.value);
          }
        }}
        className="h-9 rounded-md border border-border bg-background px-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <option value="light">ライト</option>
        <option value="dark">ダーク</option>
        <option value="system">システム</option>
      </select>
    </div>
  );
}
