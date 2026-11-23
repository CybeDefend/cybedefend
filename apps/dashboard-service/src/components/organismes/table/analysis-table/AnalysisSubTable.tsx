import React from "react";
import { AnalysisType, ScanSourceType } from "../../../../server/interfaces/Project";
import TableHeaderCell from "../../../atoms/table/TableHeaderCell";
import AnalysisRow from "../../../molecules/project/AnalysisRow";
import { useTranslation } from "react-i18next";

interface AnalysisSubTableProps {
  analyses: AnalysisType[];
  projectId: string;
  lastScanSourceType: ScanSourceType;
}

const AnalysisSubTable: React.FC<AnalysisSubTableProps> = ({
  analyses,
  projectId,
  lastScanSourceType,
}) => {
  const { t } = useTranslation();

  return (
    <table className="min-w-full divide-y divide-gray-200 dark:divide-neutral-700">
      <thead className="bg-alternative dark:bg-neutral-800">
        <tr className="">
          <TableHeaderCell>{t('components.analysisSubTable.analysisType')}</TableHeaderCell>
          <TableHeaderCell>{t('components.analysisSubTable.lastScan')}</TableHeaderCell>
          <TableHeaderCell>{t('components.analysisSubTable.lastSourceScan')}</TableHeaderCell>
          <TableHeaderCell>{t('components.analysisSubTable.issues')}</TableHeaderCell>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-200 dark:divide-neutral-700 ">
        {analyses.map((analysis) => (
          <AnalysisRow
            key={analysis.type}
            analysis={analysis}
            projectId={projectId}
            lastScanSourceType={lastScanSourceType}
          />
        ))}
      </tbody>
    </table>
  );
};

export default AnalysisSubTable;
