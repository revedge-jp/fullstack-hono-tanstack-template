"use client";

import { useEffect, useState } from "react";

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

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("system");
  // SSR では localStorage を読めないため、マウント後に実際の設定へ同期する（ハイドレーション不一致回避）。
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("theme");
    setTheme(stored === "light" || stored === "dark" ? stored : "system");
    setMounted(true);
  }, []);

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

  function handleChange(next: Theme) {
    setTheme(next);
    if (next === "system") {
      localStorage.removeItem("theme");
    } else {
      localStorage.setItem("theme", next);
    }
    applyTheme(next);
  }

  return (
    <div className="flex items-center gap-2">
      <label htmlFor="theme-select" className="text-sm text-muted-foreground">
        テーマ
      </label>
      <select
        id="theme-select"
        value={mounted ? theme : "system"}
        onChange={(e) => {
          if (isTheme(e.target.value)) {
            handleChange(e.target.value);
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
