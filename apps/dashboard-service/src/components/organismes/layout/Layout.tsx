import React, { ReactNode, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useSelector } from "react-redux";
import Header from "../navigation/header/Header";
import Sidebar from "../navigation/sidebar/Sidebar";
import UnaskedPersonaRecorder from "@/components/molecules/on-boarding/UnaskedPersonaRecorder";
import { selectIsProductChoicePending } from "@/server/store/selectors";
import { RootState } from "@/server/store";
import { selectIsProfileLoaded } from "@/server/hooks/useLandingRedirect";
import { useRealtimeStream } from "@/server/hooks/useRealtimeStream";
import { getRegionConfig } from "@/utils/function/region";
import { ACTIVE_EXTENSIONS } from "@/edition/active";
import { Slot } from "@/edition/slots";
import { productFromPath, spaceOf, useProduct, useRememberProduct } from "@/utils/product";
import { useProductAccentRoot } from "@/utils/productAccent";
import { ShellBillingStreamProvider, useCanAskQuestions, useShellBillingStreamHost } from "./shellHooks";

interface LayoutProps {
  children: ReactNode;
  currentPath: string;
}

const Layout: React.FC<LayoutProps> = ({ children, currentPath }) => {
  const location = useLocation();
  const product = useProduct();
  // The accent of the space, for everything the wrapper below does not contain: header, sidebar, toasts, portals.
  useProductAccentRoot(product);
  // Only the signed-in shell remembers: a signed-out visitor sees this page for one commit before the redirect to the login page.
  // With the account's id, being in the space an answer promised it for its next landing keeps that promise.
  // The landing rule that reads what is remembered runs on the root `/`, which is rendered outside the shell.
  const userIdFromStore = useSelector((state: RootState) => state.user.id);
  const isProfileLoaded = useSelector(selectIsProfileLoaded);
  useRememberProduct(isProfileLoaded, userIdFromStore);
  const productChoicePending = useSelector(selectIsProductChoicePending);
  // The entry link (`?source=…`, the edition's entrySource) decides one landing, never a
  // later one, or it would override the switch. Like the promise kept above,
  // it is used up once the signed-in account stands on a page of a space,
  // unless the product question is still to be asked: saving it uses the link
  // up, and it may open later than this page (a profile, an organisation still
  // loading). On a page common to both spaces the account has not landed in a
  // space yet: the link waits for the landing on `/`.
  const isEntryLinkAwaitedByAQuestion = productChoicePending;
  const { pathname } = location;
  useEffect(() => {
    if (!isProfileLoaded || isEntryLinkAwaitedByAQuestion) return;
    if (productFromPath(pathname) === null) return;
    ACTIVE_EXTENSIONS.entrySource?.clear();
  }, [isProfileLoaded, isEntryLinkAwaitedByAQuestion, pathname]);
  // No question on the pages where the account is signed out or suspended (shellHooks).
  const canAskQuestions = useCanAskQuestions();
  const organizationId = useSelector(
    (state: RootState) => state.organization?.selectedOrganization?.id,
  );

  // The organisation's billing stream, one per shell: Layout opens it while a
  // shell effect the edition registers listens to it (`useShellBillingStream`:
  // a billing edition's trial counters, a product space's usage) and hands
  // every event to each of them. The gateway never replays an event missed
  // while the stream was down (it ends every stream when its token expires);
  // a reconnect reaches them as `snapshot-required`.
  const shellStream = useShellBillingStreamHost();
  const realtimeBillingUrl =
    organizationId && shellStream.listening
      ? `${getRegionConfig().apiUrl}/v1/realtime/orgs/${organizationId}/billing/stream`
      : null;

  useRealtimeStream(
    realtimeBillingUrl,
    // Every event goes to every shell effect that listens.
    new Proxy({}, {
      get: (_handlers, type: string) => (env: unknown) => shellStream.dispatch(type, env),
    }),
    [organizationId, shellStream.listening],
  );

  // A product space with a frame of its own (registered through the edition
  // entry) replaces the AppSec chrome below with it; the shell effects it
  // registers are mounted on every page of the shell, with the shell's stream.
  const Frame = spaceOf(product).Frame;
  // The edition's onboarding questions; without them the core records the unasked profile.
  const ShellQuestions = ACTIVE_EXTENSIONS.ShellQuestions ?? UnaskedPersonaRecorder;
  const ShellEffects = ACTIVE_EXTENSIONS.ShellEffects;
  const withShellEffects = (content: ReactNode) => (
    <ShellBillingStreamProvider value={shellStream.register}>
      {ShellEffects && <ShellEffects product={product} />}
      {content}
    </ShellBillingStreamProvider>
  );
  if (Frame) return withShellEffects(<Frame currentPath={currentPath}>{children}</Frame>);

  return withShellEffects(
    <>
      <Header currentPath={currentPath} product={product} />
      <Sidebar />
      {/* The shell's overlays registered by the active edition — in a private
          build, the Cybe chat's FAB and drawer (an `app.shell.overlays`
          registration, with its AppSec/member gating inside); in a community
          build the slot is empty and renders nothing. */}
      <Slot name="app.shell.overlays" />
      {/* The persona question, to anyone who has not answered it (the
          Platform tour waits on it), and the product question of an
          organisation with no active product, to whoever can activate one.
          Self-gating; this condition only rules out the pages, and the
          suspended state, where nothing may be asked. */}
      {canAskQuestions && <ShellQuestions />}
      <div className="w-full lg:ps-56 min-h-[calc(100dvh-3.5rem)] bg-as-bg" data-product={product}>
        {/* What the edition shows over the Platform's pages (a billing edition's
            trial banner): the Platform space only (a space with a frame has its own shell). */}
        <Slot name="app.banners" context={{ organizationId, product }} />
        <div className="space-y-4 sm:space-y-6 h-min-screen pb-24">
          {children}
        </div>
      </div>
    </>,
  );
};

export default Layout;
