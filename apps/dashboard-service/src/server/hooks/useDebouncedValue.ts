

import { useState, useEffect } from 'react';

const useDebouncedValue = (value: string, delay: number): string => {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    // Skip if value hasn't actually changed
    if (value === debouncedValue) {
      return;
    }
    
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay, debouncedValue]);

  return debouncedValue;
};

export default useDebouncedValue;
