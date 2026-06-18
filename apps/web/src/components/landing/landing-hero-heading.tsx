import { useEffect, useMemo, useRef, useState } from "react";

// ─── Animated Department Heading ──────────────────────────────────────────────

export function AnimatedDepartment({
  department,
  color,
  isActive,
}: {
  department: string;
  color: string;
  isActive: boolean;
}) {
  const [displayedText, setDisplayedText] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const prevDeptRef = useRef(department);

  useEffect(() => {
    if (!isActive) {
      return;
    }

    // When department changes, start fresh
    if (prevDeptRef.current !== department) {
      prevDeptRef.current = department;
      setDisplayedText("");
      setIsTyping(true);
    }
  }, [department, isActive]);

  // Start typing on mount
  useEffect(() => {
    setIsTyping(true);
  }, []);

  useEffect(() => {
    if (!isTyping || !isActive) {
      return;
    }

    if (displayedText.length < department.length) {
      const timeout = setTimeout(() => {
        setDisplayedText(department.slice(0, displayedText.length + 1));
      }, 70);
      return () => clearTimeout(timeout);
    } else {
      setIsTyping(false);
    }
  }, [displayedText, department, isTyping, isActive]);

  const textStyle = useMemo(() => ({ color }), [color]);

  return (
    <span className="inline-flex items-baseline">
      <span style={textStyle}>{displayedText}</span>
    </span>
  );
}
