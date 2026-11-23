import React from 'react';

interface CodeExampleViewerProps {
    filename: string;
    content: string;
}

const CodeExampleViewer: React.FC<CodeExampleViewerProps> = ({ filename, content }) => {
    return (
        <div className="mb-6">
            <p className="text-xs font-mono text-zinc-500 dark:text-zinc-400 mb-2">{filename}</p>
            <pre className="p-4 max-h-[60vh] overflow-y-auto custom-scrollbar text-sm rounded-lg border bg-zinc-50 dark:bg-white/[0.03] border-zinc-200 dark:border-as-line text-zinc-800 dark:text-zinc-200">
                <code>
                    {content}
                </code>
            </pre>
        </div>
    );
};

export default CodeExampleViewer;