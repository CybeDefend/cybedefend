import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toPng } from 'html-to-image';
import jsPDF from 'jspdf';
import Button from '@/components/atoms/button/Button';
import { FilePdf, Image as ImageIcon } from '@/components/atoms/icon/icons';

/** A 28 px square around the glyph, quiet until hovered; on a phone the atom adds its 44 px reach. */
const GLYPH_BUTTON = 'h-7 w-7 px-0 text-zinc-500 hover:text-zinc-800 dark:text-zinc-500 dark:hover:text-zinc-200';

interface ExportButtonsProps {
  /** The block exported: rendered to a PNG at twice the pixel ratio on a white page. */
  targetRef: React.RefObject<HTMLDivElement | null>;
  /** The file name without its extension. */
  filename: string;
}

/**
 * The PNG and PDF export of a chart block, as two quiet glyph buttons in its
 * title row, each named « Export as PNG / PDF » for the reader and the tooltip
 * (four « PNG PDF » word pairs on one page read as noise). One component for both overview pages (each used to carry its own
 * copy, on native buttons); what it produces is unchanged: the block drawn by
 * html-to-image on a white page, and for the PDF a page the size of that image.
 */
const ExportButtons: React.FC<ExportButtonsProps> = ({ targetRef, filename }) => {
  const { t } = useTranslation();
  const [exporting, setExporting] = useState(false);

  const snapshot = async () => {
    if (!targetRef.current) return null;
    return toPng(targetRef.current, { backgroundColor: '#ffffff', quality: 1, pixelRatio: 2 });
  };

  const exportAsPng = async () => {
    setExporting(true);
    try {
      const dataUrl = await snapshot();
      if (!dataUrl) return;
      const link = document.createElement('a');
      link.download = `${filename}.png`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error('Export PNG failed:', err);
    } finally {
      setExporting(false);
    }
  };

  const exportAsPdf = async () => {
    setExporting(true);
    try {
      const dataUrl = await snapshot();
      if (!dataUrl) return;
      const img = new Image();
      img.src = dataUrl;
      await new Promise((resolve) => {
        img.onload = resolve;
      });
      const pdf = new jsPDF({
        orientation: img.width > img.height ? 'landscape' : 'portrait',
        unit: 'px',
        format: [img.width, img.height],
      });
      pdf.addImage(dataUrl, 'PNG', 0, 0, img.width, img.height);
      pdf.save(`${filename}.pdf`);
    } catch (err) {
      console.error('Export PDF failed:', err);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex items-center gap-0.5">
      <Button
        variant="ghost"
        size="xs"
        onClick={exportAsPng}
        disabled={exporting}
        title={t('pages.organizationOverview.export.png')}
        aria-label={t('pages.organizationOverview.export.png')}
        icon={<ImageIcon className="h-3.5 w-3.5" />}
        className={GLYPH_BUTTON}
      />
      <Button
        variant="ghost"
        size="xs"
        onClick={exportAsPdf}
        disabled={exporting}
        title={t('pages.organizationOverview.export.pdf')}
        aria-label={t('pages.organizationOverview.export.pdf')}
        icon={<FilePdf className="h-3.5 w-3.5" />}
        className={GLYPH_BUTTON}
      />
    </div>
  );
};

export default ExportButtons;
