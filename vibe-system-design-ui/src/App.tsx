import { useRef, useState, useEffect } from "react";
import { Sun, Moon, Search } from "lucide-react";
import Canvas from "./canvas/Canvas";
import { ChatPanel } from "./components/chat/ChatPanel";

const CanvasScreen = () => {
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "/" || e.code === "Slash")) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const [theme, setTheme] = useState<"light" | "dark">(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("vibe-theme");
      if (stored === "dark" || stored === "light") return stored;
      return window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    }
    return "light";
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
    localStorage.setItem("vibe-theme", theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  };

  return (
    <div className="wrapper w-full h-full relative">
      <Canvas theme={theme} />
      {/* Top-Center Spotlight Search Bar — moved to bottom-center: Excalidraw's
          own toolbar owns the top-center strip. */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-50">
        <div
          onClick={() => searchInputRef.current?.focus()}
          className="flex items-center gap-2 px-3 py-1.5 w-72 sm:w-80 md:w-96 rounded-[8px] bg-white dark:bg-[#202020] text-black dark:text-white border border-[#e6e6e6] dark:border-[#2f2f2f] hover:border-[#0075de]/40 dark:hover:border-[#0075de]/40 focus-within:border-[#0075de] dark:focus-within:border-[#0075de] focus-within:hover:border-[#0075de] dark:focus-within:hover:border-[#0075de] focus-within:ring-1 focus-within:ring-[#0075de] dark:focus-within:ring-[#0075de] transition-colors shadow-[0px_0.175px_1.041px_0px_rgba(0,0,0,0.01),0px_0.8px_2.925px_0px_rgba(0,0,0,0.02),0px_2.025px_7.847px_0px_rgba(0,0,0,0.027)] cursor-text"
        >
          <Search className="w-3.5 h-3.5 text-neutral-400 dark:text-neutral-500 shrink-0" />
          <input
            ref={searchInputRef}
            type="text"
            placeholder="What resource to add next?"
            className="flex-1 bg-transparent text-xs text-black dark:text-white placeholder:text-neutral-400 dark:placeholder:text-neutral-500 outline-none font-medium min-w-0"
          />
          <kbd className="text-[10px] font-medium text-neutral-400 dark:text-neutral-500 font-sans tracking-tight border border-neutral-200 dark:border-neutral-700/60 rounded px-1.5 py-0.5 shrink-0 select-none">
            ⌘ + /
          </kbd>
        </div>
      </div>
      {/* Top-Right Theme Toggle */}
      <div className="absolute top-4 right-4 z-50">
        <button
          onClick={toggleTheme}
          aria-label="Toggle theme"
          className="flex items-center gap-2 px-3 py-1.5 rounded-[8px] bg-white dark:bg-[#202020] text-black dark:text-white border border-[#e6e6e6] dark:border-[#2f2f2f] hover:bg-[#f6f5f4] dark:hover:bg-[#2a2a2a] transition-colors shadow-[0px_0.175px_1.041px_0px_rgba(0,0,0,0.01),0px_0.8px_2.925px_0px_rgba(0,0,0,0.02),0px_2.025px_7.847px_0px_rgba(0,0,0,0.027)] cursor-pointer text-xs font-medium"
        >
          {theme === "dark" ? (
            <>
              <Sun className="w-3.5 h-3.5 text-[#0075de]" />
              <span>Light</span>
            </>
          ) : (
            <>
              <Moon className="w-3.5 h-3.5 text-[#0075de]" />
              <span>Dark</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};

function App() {
  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <div className="h-full w-[65%] min-w-0">
        <CanvasScreen />
      </div>
      <ChatPanel />
    </div>
  );
}

export default App;