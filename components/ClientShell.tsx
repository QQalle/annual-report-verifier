"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Files, PanelRightClose, PanelRightOpen, ScanSearch } from "lucide-react";
import { useState, type ReactNode } from "react";
import { ModelProviderRoot, useModel } from "@/lib/model-context";
import { ModelSidebar } from "./ClaudeSidebar";

function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const { isConfigured, provider } = useModel();

  return (
    <div className={`app-shell ${sidebarOpen ? "sidebar-is-open" : ""}`}>
      <header className="topbar">
        <nav className="primary-nav" aria-label="Primary navigation">
          <Link className={pathname.startsWith("/library") ? "active" : ""} href="/library">
            <Files size={15} />
            Library
          </Link>
          <Link className={pathname.startsWith("/analyze") ? "active" : ""} href="/analyze">
            <ScanSearch size={15} />
            Analyze
          </Link>
        </nav>
        <h1 className="product-title">Third Pass</h1>
        <div className="topbar-spacer" />
        <button
          className="sidebar-toggle"
          type="button"
          onClick={() => setSidebarOpen((open) => !open)}
          aria-expanded={sidebarOpen}
          aria-controls="model-sidebar"
        >
          <span className={`connection-dot ${isConfigured ? "connected" : ""}`} />
          {provider === "openai" ? "OpenAI" : "Anthropic"}
          {sidebarOpen ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}
        </button>
      </header>
      <div className="shell-body">
        <main className="product-surface">{children}</main>
        {sidebarOpen && <ModelSidebar onClose={() => setSidebarOpen(false)} />}
      </div>
    </div>
  );
}

export function ClientShell({ children }: { children: ReactNode }) {
  return (
    <ModelProviderRoot>
      <Shell>{children}</Shell>
    </ModelProviderRoot>
  );
}
