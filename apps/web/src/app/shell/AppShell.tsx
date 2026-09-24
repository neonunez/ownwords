import { useCallback, useEffect, useRef, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { TabBar } from "../../design-system";
import {
  activeTabKey,
  homeFor,
  modeFromPath,
  tabsFor,
  type Mode,
} from "../navigation";
import { OverlayProvider, useOverlayHost } from "./OverlayHost";
import { SidePanel } from "./SidePanel";
import { ToastProvider } from "./ToastProvider";
import { UpdatePrompt } from "../../pwa/UpdatePrompt";
import { useAsync } from "./useAsync";
import { useClient } from "./ClientProvider";

interface PanelState {
  panel?: boolean;
}

/**
 * The app frame: one scrolling screen, the tab bar beneath it, and the side
 * panel over both. The panel takes a history entry of its own, so the phone's
 * back gesture closes it before it leaves the screen.
 */
export function AppShell() {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  return (
    <div className="ow-app">
      <OverlayProvider host={host}>
        <ToastProvider>
          <ShellBody setHost={setHost} />
          <UpdatePrompt />
        </ToastProvider>
      </OverlayProvider>
    </div>
  );
}

function ShellBody({
  setHost,
}: {
  setHost: (node: HTMLDivElement | null) => void;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const client = useClient();
  const mainRef = useRef<HTMLElement>(null);
  const { locked } = useOverlayHost();

  const mode: Mode = modeFromPath(location.pathname);
  const tabs = tabsFor(mode);
  const activeKey = activeTabKey(location.pathname);
  const panelOpen = Boolean((location.state as PanelState | null)?.panel);

  const languages = useAsync(() => client.listLanguages(), [client]);

  const openPanel = useCallback(() => {
    navigate(`${location.pathname}${location.search}`, {
      state: { panel: true },
    });
  }, [navigate, location.pathname, location.search]);

  const closePanel = useCallback(() => {
    navigate(-1);
  }, [navigate]);

  const changeMode = useCallback(
    (next: Mode) => {
      // Replacing the panel's own history entry closes it and lands on the
      // mode's home screen in one step, leaving the back stack tidy.
      navigate(homeFor[next], { replace: true, state: null });
    },
    [navigate],
  );

  // A new screen starts at the top, the way a pushed screen does on a phone.
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [location.pathname]);

  const sealed = locked || panelOpen;

  return (
    <>
      <main ref={mainRef} className="ow-main" id="ow-main" inert={sealed}>
        <div className="ow-screen" key={location.pathname}>
          <Outlet context={{ openPanel }} />
        </div>
      </main>

      {/* Sheets and the floating action sit above the screen but before the tab
          bar, so the keyboard reaches them in the order the eye does. */}
      <div ref={setHost} />

      <div inert={sealed}>
        <TabBar
          tabs={tabs}
          activeKey={activeKey}
          label={mode === "learn" ? "Learn" : "Maintain"}
          onSelect={(href, event) => {
            if (
              event.metaKey ||
              event.ctrlKey ||
              event.shiftKey ||
              event.button !== 0
            )
              return;
            event.preventDefault();
            navigate(href);
          }}
        />
      </div>

      <SidePanel
        open={panelOpen}
        onClose={closePanel}
        mode={mode}
        onModeChange={changeMode}
        languages={languages.data ?? []}
      />
    </>
  );
}
