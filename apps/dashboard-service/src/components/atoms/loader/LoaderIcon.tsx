import React from "react";

import SpinnerArc from "./SpinnerArc";

/**
 * The small inline spinner of a button or a line of text: the loaders' hairline
 * arc at 16 px, in the product accent (violet in AppSec, ink in another product space).
 */
const LoaderIcon = () => {
  return <SpinnerArc size="sm" aria-hidden="true" className="inline-block text-secondary" />;
};

export default LoaderIcon;
