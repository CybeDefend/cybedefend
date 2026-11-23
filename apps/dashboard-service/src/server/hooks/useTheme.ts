import { useEffect, useState } from 'react';

/**
 * Custom hook to manage dark/light theme state with localStorage persistence
 * 
 * This hook ensures consistent theme state across the entire application
 * by reading from localStorage on initialization and persisting changes.
 * 
 * @returns {Object} Object containing isDarkMode state and toggleTheme function
 */
const useTheme = () => {
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    // Initialize from localStorage or default to false (light mode)
    const savedTheme = localStorage.getItem("theme");
    return savedTheme === "dark";
  });

  /**
   * Initialize theme on component mount
   * Ensures DOM classes are in sync with localStorage state
   */
  useEffect(() => {
    const savedTheme = localStorage.getItem("theme");
    const isDark = savedTheme === "dark";
    
    setIsDarkMode(isDark);
    
    // Apply or remove dark class to document
    if (isDark) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, []);

  /**
   * Toggle between dark and light themes
   * Updates localStorage, DOM classes, and dispatches theme change event
   */
  const toggleTheme = () => {
    const newTheme = !isDarkMode;
    setIsDarkMode(newTheme);
    
    if (newTheme) {
      document.documentElement.classList.add("dark");
      localStorage.setItem("theme", "dark");
    } else {
      document.documentElement.classList.remove("dark");
      localStorage.setItem("theme", "light");
    }
    
    // Dispatch event for other components that might listen to theme changes
    window.dispatchEvent(new Event("themeChange"));
  };

  return {
    isDarkMode,
    toggleTheme
  };
};

export default useTheme;
