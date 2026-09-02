import { StartClient } from "@tanstack/react-start/client";
import { StrictMode, startTransition } from "react";
import { hydrateRoot } from "react-dom/client";

import { installClientErrorReporting } from "@/shared/lib/report-client-error";

// ハイドレーション前に仕掛ける — ハイドレーション自体の失敗も捕捉対象にするため。
installClientErrorReporting();

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <StartClient />
    </StrictMode>,
  );
});
