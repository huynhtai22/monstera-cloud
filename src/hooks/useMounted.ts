import { useEffect, useState } from "react";

/** True after client mount — safe for `createPortal(..., document.body)`. */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  return mounted;
}
