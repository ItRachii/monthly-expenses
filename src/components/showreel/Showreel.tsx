"use client";

import { useEffect, useRef } from "react";
import s from "./Showreel.module.css";

// The sign-in page's right panel: a 27s loop showing Ledger at work. A blurred
// zoom into the card stack, which shuffles; the expenses table arriving and
// filtering down; the week's bars lighting up under a pointer; then back out
// to the overview. Example data only.
//
// The markup is the final, resting frame (what reduced motion, no script and
// a paused panel show). A timeline then drives it by toggling classes on the
// DOM directly: no React render per beat. It stops while the tab is hidden or
// the panel is off screen, and starts over when it comes back.

const W = 600;
const H = 560;
const RECTS = {
  card: { x: 40, y: 40, w: 250, h: 220 },
  act: { x: 310, y: 40, w: 250, h: 220 },
  tx: { x: 40, y: 280, w: 520, h: 240 },
} as const;
type Scene = "grid" | keyof typeof RECTS;
const SCENES: { id: Scene; label: string }[] = [
  { id: "grid", label: "Overview" },
  { id: "card", label: "Cards" },
  { id: "tx", label: "Expenses" },
  { id: "act", label: "Week" },
];
const LOOP_MS = 27000;

const CARD_STYLES = [s.glass, s.grad, s.solid];
const WEEK = [0.34, 0.72, 0.42, 0.55, 0.22, 0.4, 0.43];
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const LIT_AT_REST = 3;
const TX = [
  { name: "Groceries, BigBasket", amount: "₹2,340.00", status: "Settled", tone: s.positive, date: "24 Nov 2026" },
  { name: "Electricity bill", amount: "₹1,876.50", status: "Pending", tone: s.warning, date: "12 Nov 2026" },
  { name: "Dinner at Toit", amount: "₹3,420.00", status: "Owed to you", tone: s.info, date: "28 Oct 2026" },
  { name: "Cab to airport", amount: "₹865.00", status: "You owe", tone: s.negative, date: "18 Sep 2026" },
  { name: "Flat rent, share", amount: "₹18,500.00", status: "Settled", tone: s.positive, date: "30 Jul 2026" },
  { name: "Weekend trek", amount: "₹4,210.00", status: "Settled", tone: s.positive, date: "14 Jun 2026" },
  { name: "Office party", amount: "₹1,500.00", status: "Settled", tone: s.positive, date: "03 Apr 2026" },
];
const RANGES = [
  { id: "year", label: "This year" },
  { id: "6m", label: "6 months" },
  { id: "3m", label: "3 months" },
  { id: "month", label: "This month" },
];

// Where the pointer goes, in stage coordinates.
const DD = { x: 40 + 520 - 62, y: 280 + 24 };
const menuItem = (i: number) => ({ x: 40 + 520 - 50, y: 280 + 33 + i * 13 });
const barPoint = (i: number, h: number) => ({ x: 310 + 34 + i * 29 + 10, y: 40 + 44 + 146 * (1 - h) + 14 });

function Logo({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 40 40" width={size} height={size} fill="none" aria-hidden>
      <circle cx="20" cy="20" r="16" stroke="#fff" strokeWidth="3" />
      <path d="M4 20a16 16 0 0 0 32 0Z" fill="#fff" />
    </svg>
  );
}

export function Showreel() {
  const root = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const q = <T extends Element>(sel: string) => el.querySelector<T>(sel)!;
    const qa = <T extends Element>(sel: string) => Array.from(el.querySelectorAll<T>(sel));
    const fit = q<HTMLDivElement>("[data-fit]");
    const cam = q<HTMLDivElement>("[data-cam]");
    const cursor = q<HTMLDivElement>("[data-cursor]");
    const bars = q<HTMLDivElement>("[data-bars]");
    const lit = qa<HTMLDivElement>("[data-lit]");
    const fills = qa<HTMLDivElement>("[data-fill]");
    const rows = qa<HTMLDivElement>("[data-row]");
    const title = q<HTMLDivElement>("[data-title]");
    const thead = q<HTMLDivElement>("[data-thead]");
    const menu = q<HTMLDivElement>("[data-menu]");
    const dd = q<HTMLSpanElement>("[data-dd]");
    const ddLabel = q<HTMLSpanElement>("[data-dd-label]");
    const chips = qa<HTMLSpanElement>("[data-chip]");
    const stackCards = qa<HTMLDivElement>("[data-bcard]");
    const still = window.matchMedia("(prefers-reduced-motion: reduce)");

    // Scale the 600x560 stage to the panel.
    const resize = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      const k = Math.min(r.width / W, r.height / H) * 0.98;
      fit.style.transform = `scale(${k}) translate(-50%, -50%)`;
    });
    resize.observe(el);

    let camState = { s: 1, tx: 0, ty: 0 };
    const restart = (node: HTMLElement, cls: string) => {
      node.classList.remove(cls);
      void node.offsetWidth;
      node.classList.add(cls);
    };
    const camTo = (scene: Scene, animate = true) => {
      let k = 1, tx = 0, ty = 0;
      if (scene !== "grid") {
        const r = RECTS[scene];
        // The wide table crops its edges a little, so the move still reads as a zoom.
        k = scene === "tx" ? 1.16 : Math.min((W * 0.9) / r.w, (H * 0.9) / r.h);
        tx = W / 2 - k * (r.x + r.w / 2);
        ty = H / 2 - k * (r.y + r.h / 2);
      }
      camState = { s: k, tx, ty };
      cam.style.transform = `translate(${tx}px, ${ty}px) scale(${k})`;
      if (animate) restart(cam, s.blur);
      chips.forEach((c) => c.classList.toggle(s.chipOn, c.dataset.chip === scene));
    };
    const cursorTo = (p: { x: number; y: number }) => {
      cursor.style.transform = `translate(${camState.tx + camState.s * p.x}px, ${camState.ty + camState.s * p.y}px)`;
      cursor.classList.add(s.on);
    };
    const click = () => {
      cursor.classList.add(s.click);
      window.setTimeout(() => cursor.classList.remove(s.click), 160);
    };

    // Cards: slot 0 is the front. A shuffle sends the front card down and
    // behind; the others step forward.
    let order = [...stackCards];
    const placeCards = () =>
      order.forEach((c, i) => {
        c.classList.remove(s.s0, s.s1, s.s2, s.leaving);
        c.classList.add([s.s0, s.s1, s.s2][i]);
      });
    const shuffle = () => {
      const front = order[0];
      front.classList.add(s.leaving);
      order[1].classList.replace(s.s1, s.s0);
      order[2].classList.replace(s.s2, s.s1);
      order = [...order.slice(1), front];
      window.setTimeout(() => {
        front.classList.remove(s.leaving, s.s0);
        front.classList.add(s.s2);
      }, 760);
    };

    const lightBar = (i: number) => lit.forEach((l, j) => (l.style.height = j === i ? `${WEEK[j] * 100}%` : "0"));
    const barsGrow = () => {
      fills.forEach((f, i) => (f.style.animationDelay = `${i * 70}ms`));
      restart(bars, s.grow);
    };

    const txIntro = () => {
      title.querySelectorAll("span").forEach((w, i) => (w.style.animationDelay = `${i * 90}ms`));
      restart(title, s.intro);
      restart(thead, s.theadIn);
      rows.forEach((r, i) => {
        r.classList.remove(s.gone);
        r.style.animationDelay = `${420 + i * 60}ms`;
        restart(r, s.rowIn);
      });
      ddLabel.textContent = RANGES[0].label;
    };
    const keep = (n: number, label: string) => {
      ddLabel.textContent = label;
      rows.forEach((r, i) => {
        r.classList.remove(s.rowIn);
        r.classList.toggle(s.gone, i >= n);
      });
    };
    const openMenu = (on: boolean) => {
      menu.classList.toggle(s.open, on);
      dd.classList.toggle(s.press, on);
    };
    const highlight = (id: string | null) => menu.querySelectorAll<HTMLDivElement>("[data-range]").forEach((d) => d.classList.toggle(s.hl, d.dataset.range === id));

    // The resting frame: everything settled, the overview in shot.
    const rest = () => {
      order = [...stackCards];
      placeCards();
      rows.forEach((r) => r.classList.remove(s.gone, s.rowIn));
      title.classList.remove(s.intro);
      thead.classList.remove(s.theadIn);
      bars.classList.remove(s.grow);
      ddLabel.textContent = RANGES[0].label;
      openMenu(false);
      highlight(null);
      lightBar(LIT_AT_REST);
      cursor.classList.remove(s.on);
      camTo("grid", false);
    };

    const SCRIPT: [number, () => void][] = [
      [0, rest],
      [1200, () => { lightBar(-1); camTo("card"); }],
      [2600, shuffle],
      [3900, shuffle],
      [5200, shuffle],
      [7000, () => { camTo("tx"); txIntro(); }],
      [9000, () => cursorTo({ x: DD.x + 40, y: DD.y + 60 })],
      [9700, () => cursorTo(DD)],
      [10450, () => { click(); openMenu(true); }],
      [10900, () => { cursorTo(menuItem(2)); highlight("3m"); }],
      [11700, () => { click(); openMenu(false); keep(4, RANGES[2].label); }],
      [12900, () => cursorTo(DD)],
      [13500, () => { click(); openMenu(true); highlight("3m"); }],
      [13950, () => { cursorTo(menuItem(3)); highlight("month"); }],
      [14700, () => { click(); openMenu(false); keep(2, RANGES[3].label); }],
      [15700, () => { cursor.classList.remove(s.on); camTo("act"); lightBar(-1); barsGrow(); }],
      [17100, () => cursorTo(barPoint(1, 0.3))],
      [17700, () => lightBar(1)],
      [19000, () => cursorTo(barPoint(0, 0.2))],
      [19400, () => lightBar(0)],
      [20500, () => cursorTo(barPoint(3, 0.3))],
      [20900, () => lightBar(3)],
      [22300, () => { cursor.classList.remove(s.on); camTo("grid"); }],
      [23300, () => { rows.forEach((r) => r.classList.remove(s.gone)); ddLabel.textContent = RANGES[0].label; }],
    ];

    let timers: number[] = [];
    let onScreen = true;
    const stop = () => {
      timers.forEach((t) => window.clearTimeout(t));
      timers = [];
    };
    const run = () => {
      stop();
      rest();
      if (still.matches) {
        chips.forEach((c) => c.classList.remove(s.chipOn));
        return;
      }
      for (const [t, fn] of SCRIPT) timers.push(window.setTimeout(fn, t));
      timers.push(window.setTimeout(run, LOOP_MS));
    };
    const sync = () => (onScreen && !document.hidden ? run() : stop());
    const seen = new IntersectionObserver(([e]) => {
      if (e.isIntersecting === onScreen) return;
      onScreen = e.isIntersecting;
      sync();
    }, { threshold: 0.2 });
    seen.observe(el);
    document.addEventListener("visibilitychange", sync);
    still.addEventListener("change", sync);
    run();

    return () => {
      stop();
      resize.disconnect();
      seen.disconnect();
      document.removeEventListener("visibilitychange", sync);
      still.removeEventListener("change", sync);
    };
  }, []);

  return (
    // Always the dark theme, whatever the page's: the artwork is drawn for it.
    <section
      ref={root}
      data-theme="dark"
      className={s.reel}
      aria-label="Animated preview of Ledger: a card stack, an expenses table filtering by date, and a week of spending by day. Example data."
    >
      <div className={s.bg} />
      <div className={s.watermark} aria-hidden>
        Ledger
      </div>
      <div className={s.fit} data-fit aria-hidden>
        <div className={s.cam} data-cam>
          <div className={`${s.w} ${s.wCard}`}>
            <div className={s.cap}>Cards</div>
            <div className={s.stack}>
              {CARD_STYLES.map((style, i) => (
                <div key={style} data-bcard className={`${s.bcard} ${style} ${[s.s0, s.s1, s.s2][i]}`}>
                  <div className={s.brow}>
                    <span className={s.bname}>Ledger</span>
                    <Logo size={14} />
                  </div>
                  <div className={s.bno}>•••• •••• •••• 0329</div>
                  <div className={s.brow}>
                    <div>
                      <div className={s.blbl}>Card holder</div>
                      <div className={s.bval}>RIYA KAPOOR</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div className={s.blbl}>Expires</div>
                      <div className={s.bval}>10/28</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className={`${s.w} ${s.wAct}`}>
            <div className={s.head}>
              <span>This week</span>
              <span className={s.plus}>+</span>
            </div>
            <div className={s.yax}>
              {["4k", "3k", "2k", "1k", "0"].map((t) => (
                <span key={t}>{t}</span>
              ))}
            </div>
            <div className={s.bars} data-bars>
              {WEEK.map((h, i) => (
                <div key={i} className={s.bar}>
                  <div data-fill className={s.fill} style={{ height: `${h * 100}%` }} />
                  <div data-lit className={s.lit} style={{ height: i === LIT_AT_REST ? `${h * 100}%` : 0 }} />
                </div>
              ))}
            </div>
            <div className={s.days}>
              {DAYS.map((d) => (
                <span key={d}>{d}</span>
              ))}
            </div>
          </div>

          <div className={`${s.w} ${s.wTx}`}>
            <div className={s.txHead}>
              <div className={s.title} data-title>
                <span>All</span>
                <span>expenses</span>
              </div>
              <div className={s.tools}>
                <span className={s.dd} data-dd>
                  <span data-dd-label>{RANGES[0].label}</span>
                  <svg width="7" height="7" viewBox="0 0 10 10" aria-hidden>
                    <path d="M2 3.5l3 3 3-3" stroke="currentColor" fill="none" strokeWidth="1.5" />
                  </svg>
                </span>
                <span className={s.kebab}>⋮</span>
                <div className={s.menu} data-menu>
                  {RANGES.map((r) => (
                    <div key={r.id} data-range={r.id}>
                      {r.label}
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className={s.thead} data-thead>
              <span>Expense</span>
              <span>Amount</span>
              <span>Status</span>
              <span>Date</span>
            </div>
            {TX.map((t) => (
              <div key={t.name} data-row className={s.row}>
                <span>{t.name}</span>
                <span className={s.num}>{t.amount}</span>
                <span className={`${s.pill} ${t.tone}`}>{t.status}</span>
                <span className={s.muted}>{t.date}</span>
              </div>
            ))}
          </div>
        </div>
        <div className={s.cursor} data-cursor>
          <svg width="18" height="18" viewBox="0 0 24 24">
            <path d="M4 2l16 9-7 2-3 7z" fill="#fff" stroke="#111" strokeWidth="1.6" strokeLinejoin="round" />
          </svg>
        </div>
      </div>
      <div className={s.foot} aria-hidden>
        <div className={s.chips}>
          {SCENES.map((c) => (
            <span key={c.id} data-chip={c.id}>
              {c.label}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
