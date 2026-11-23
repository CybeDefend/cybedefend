import { Link, useLocation } from 'react-router-dom';
import { productFromPath, productHome, readLastProduct } from '@/utils/product';

export const Logo: React.FC = () => {
  const { pathname } = useLocation();
  // The logo leads to the home of the product the user is in. On a page common
  // to both, the last product used; with none yet, the root, where the landing
  // rule reads the account's answers instead of assuming AppSec.
  const product = productFromPath(pathname) ?? readLastProduct();
  const home = product ? productHome(product) : '/';

  return (
    <div className="relative overflow-hidden px-2.5">
      <Link
        // 6 px above and below the 32 px wordmark: a 44 px link, for a thumb in the drawer.
        className="inline-flex rounded-md py-1.5 focus:outline-none focus-visible:ring-1 focus-visible:ring-white/25"
        to={home}
        aria-label="CybeDefend"
      >
        <img className="h-8 w-auto" src="/logo-white.webp" alt="Logo" />
      </Link>
    </div>
  );
};
