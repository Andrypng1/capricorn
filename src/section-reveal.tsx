import { useEffect, useRef, type ReactNode } from "react";

export function SectionReveal({ children }: { children: ReactNode }) {
  const section = useRef<HTMLElement>(null);
  useEffect(() => {
    const element = section.current;
    if (!element || window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
        element.getBoundingClientRect().top < window.innerHeight) return;

    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      element.classList.add("section-enter");
      observer.disconnect();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return <section ref={section}>{children}</section>;
}
