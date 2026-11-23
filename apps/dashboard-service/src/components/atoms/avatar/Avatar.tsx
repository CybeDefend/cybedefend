import React, { useRef, useState } from "react";

interface AvatarProps {
  src?: string;
  alt: string;
  size?: string;
}

const Avatar: React.FC<AvatarProps> = ({ src, alt, size = "w-10 h-10" }) => {
  const [imageError, setImageError] = useState(false);
  const [isWhite, setIsWhite] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);

  const initials = alt?.charAt(0)?.toUpperCase() || "?";

  const handleImageLoad = () => {
    if (!imgRef.current) return;
    try {
      const imgEl = imgRef.current;
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      canvas.width = imgEl.naturalWidth;
      canvas.height = imgEl.naturalHeight;
      ctx.drawImage(imgEl, 0, 0);
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const totalPixels = data.length / 4;
      let whitePixels = 0;
      const channelThreshold = 240;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const a = data[i + 3];
        if (
          r >= channelThreshold &&
          g >= channelThreshold &&
          b >= channelThreshold &&
          a >= 240
        ) {
          whitePixels++;
        }
      }
      const ratio = whitePixels / totalPixels;
      if (ratio > 0.8) {
        setIsWhite(true);
      }
    } catch {}
  };

  const handleImageError = () => {
    setImageError(true);
  };

  // No photo: the initial on a quiet zinc disc, as the kit's `PersonAvatar`
  // (a disc is not a place for the accent).
  if (imageError || !src) {
    return (
      <div
        className={`${size} flex shrink-0 items-center justify-center rounded-full bg-zinc-200 text-[13px] font-medium text-zinc-700 dark:bg-white/[0.08] dark:text-zinc-200`}
      >
        {initials}
      </div>
    );
  }

  return (
    <img
      ref={imgRef}
      src={src}
      alt={alt}
      className={`shrink-0 ${size} rounded-full object-cover ${
        isWhite ? "filter grayscale contrast-75" : ""
      }`}
      onLoad={handleImageLoad}
      onError={handleImageError}
      referrerPolicy="no-referrer"
    />
  );
};

export default Avatar;
