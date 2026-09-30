/**
 * SpineVExt Web —— 视频转 Spine 骨骼动画。
 *
 * 布局：左侧输入与参数、中间舞台、右侧导出，底部状态条。
 */

import { AlertTriangle, AudioLines, CircleDot, Languages, Moon, Sun } from "lucide-react";

import { ControlPanel } from "@/components/ControlPanel";
import { ExportPanel } from "@/components/ExportPanel";
import { StageColumn } from "@/components/StageColumn";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useSpinevext, type Stage } from "@/hooks/useSpinevext";
import { useTheme } from "@/hooks/useTheme";
import { LANGUAGE_LABELS, LANGUAGES, type MessageKey, useI18n } from "@/i18n";
import { cn } from "@/lib/utils";

/** 舞台状态 → 状态栏徽标的文案 key。 */
const STAGE_LABEL_KEY: Record<Stage, MessageKey> = {
  boot: "app.stage.boot",
  idle: "app.stage.idle",
  detecting: "app.stage.detecting",
  rendering: "app.stage.rendering",
  ready: "app.stage.ready",
  exporting: "app.stage.exporting",
  error: "app.stage.error",
};

export function App() {
  const controller = useSpinevext();
  const { stage, engine, message, error, result } = controller;
  const { theme, toggle } = useTheme();
  const { language, setLanguage, t } = useI18n();

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-background">
        <header className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur">
          <div className="mx-auto flex w-full max-w-[1680px] flex-wrap items-center gap-4 px-6 py-3">
            <div className="flex items-baseline gap-3">
              <span className="text-base font-semibold tracking-tight">
                SPINE<span className="text-primary">VEXT</span>
              </span>
              <span className="tag-label">{t("app.subtitle")}</span>
            </div>

            <div className="ml-auto flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="numeral gap-1.5">
                <CircleDot aria-hidden className="size-3" />
                {t(STAGE_LABEL_KEY[stage])}
              </Badge>
              <Badge variant="outline" className="numeral">
                {t("app.badge.core")} {engine ? `v${engine.version}` : "…"}
              </Badge>
              <Badge variant="outline" className="numeral">
                {t("app.badge.keypoints")}
              </Badge>

              {/* 语言切换：三个语言直接铺开，点一下就换，不用下拉 */}
              <div
                className="flex items-center gap-0.5 rounded-md border border-border bg-muted/40 p-0.5"
                role="group"
                aria-label={t("app.language")}
                title={t("app.language")}
              >
                <Languages aria-hidden className="mx-1 size-3.5 text-muted-foreground" />
                {LANGUAGES.map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setLanguage(item)}
                    aria-pressed={language === item}
                    className={cn(
                      "numeral rounded-sm px-1.5 py-0.5 text-[11px] transition-colors",
                      language === item
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                    )}
                  >
                    {LANGUAGE_LABELS[item]}
                  </button>
                ))}
              </div>

              <Button
                variant="ghost"
                size="icon"
                onClick={toggle}
                aria-label={theme === "dark" ? t("app.theme.toLight") : t("app.theme.toDark")}
                title={theme === "dark" ? t("app.theme.toLight") : t("app.theme.toDark")}
              >
                {theme === "dark" ? <Sun aria-hidden /> : <Moon aria-hidden />}
              </Button>
            </div>
          </div>
        </header>

        {/* pb-20：底部状态栏是 fixed 的，不留出这段高度，最后一屏的按钮（尤其是导出）
            会被压在状态栏下面点不到 */}
        <main className="mx-auto grid w-full max-w-[1680px] gap-5 px-6 pt-5 pb-20 lg:grid-cols-[330px_minmax(0,1fr)_340px]">
          <ControlPanel controller={controller} />
          <StageColumn controller={controller} />
          <ExportPanel controller={controller} />
        </main>

        <footer className="fixed inset-x-0 bottom-0 border-t border-border bg-background/92 backdrop-blur">
          <div className="mx-auto flex w-full max-w-[1680px] items-center gap-3 px-6 py-2.5">
            <AudioLines aria-hidden className="size-3.5 shrink-0 text-primary" />
            <span className="numeral truncate text-[11px] text-muted-foreground">
              {t(message.key, message.params)}
            </span>
            {error ? (
              <span className="ml-auto flex items-center gap-1.5 text-[11px] text-destructive">
                <AlertTriangle aria-hidden className="size-3.5" />
                {error}
              </span>
            ) : result ? (
              <span className="numeral ml-auto shrink-0 text-[11px] text-muted-foreground">
                {result.animation.frames.length} frames · {result.frameWidth}×{result.frameHeight}
              </span>
            ) : null}
          </div>
        </footer>
      </div>
    </TooltipProvider>
  );
}
