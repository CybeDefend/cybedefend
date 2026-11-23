import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { DataFlowItem } from "../../../../server/interfaces/Vulnerability";
import CodeSnippetDataFlow from "../code-snippet/CodeSnippetDataFlow";

interface DataFlowProps {
  dataFlowItems: DataFlowItem[];
}

const DataFlow: React.FC<DataFlowProps> = ({ dataFlowItems }) => {
  const { t } = useTranslation();
  
  const orderedDataFlowItems = [...dataFlowItems].sort(
    (a, b) => a.order - b.order
  );

  const [currentStep, setCurrentStep] = useState(0);

  
  if (orderedDataFlowItems.length === 0) {
    return <div className="text-zinc-500 dark:text-zinc-400">{t('components.dataFlow.noItems')}</div>;
  }

  const currentItem = orderedDataFlowItems[currentStep];

  const handleStepClick = (index: number) => {
    setCurrentStep(index);
  };

  return (
    <div>
      {}
      <CodeSnippetDataFlow
        code={currentItem.code}
        language={currentItem.language}
        lineToHighlight={currentItem.line}
        nameHighlight={currentItem.nameHighlight}
        showLineNumbers={true}
      />

      {}
      <div className="mt-6 p-4 overflow-x-auto custom-scrollbar">
        <div className="flex items-center justify-center flex-wrap">
          {orderedDataFlowItems.map((item, index) => (
            <div key={item.id} className="flex items-center mb-2">
              <div
                className={`flex flex-col items-center cursor-pointer transition-colors duration-200 ${
                  index === currentStep
                    ? "text-primary dark:text-zinc-400"
                    : "text-zinc-500 dark:text-zinc-400 hover:text-primary dark:hover:text-zinc-200"
                }`}
                onClick={() => handleStepClick(index)}
              >
                {}
                <span
                  className={`block w-3 h-3 rounded-full mb-1 transition-colors duration-200 ${
                    index === currentStep
                      ? "bg-primary dark:bg-zinc-400"
                      : "bg-zinc-400 dark:bg-zinc-500 hover:bg-primary dark:hover:bg-zinc-300"
                  }`}
                ></span>

                {}
                <div className="flex items-center space-x-1">
                  <p className="text-sm">
                    {index === 0
                      ? t('components.dataFlow.issue')
                      : index === orderedDataFlowItems.length - 1
                      ? t('components.dataFlow.source')
                      : `${t('components.dataFlow.step')} ${index + 1}`}
                  </p>
                </div>

                {}
                <div className="flex items-center space-x-1">
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    {t('common.line')}
                  </p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    {item.line}
                  </p>
                </div>
              </div>
              {}
              {index < orderedDataFlowItems.length - 1 && (
                <div className="w-10 h-px bg-zinc-300 dark:bg-white/[0.1] mx-2"></div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default DataFlow;
