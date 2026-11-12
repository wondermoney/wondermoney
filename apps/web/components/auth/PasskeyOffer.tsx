"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { DrawerDialog } from "@/components/ui/dialog-responsive";
import { useConfirmedFeature } from "@/lib/api/instance/useInstance";
import {
  clearPasskeyOfferPending,
  isPasskeyOfferDone,
  isPasskeyOfferPending,
  markPasskeyOfferDone,
} from "@/lib/auth/passkey-offer";
import {
  browserSupportsPasskeys,
  isPasskeyCancelled,
  isSessionNotFresh,
  useAddPasskey,
  usePasskeys,
} from "@/lib/auth/passkeys";
import { useUser } from "@/lib/auth/user-context";

// The mark only changes in this tab through the functions below, which re-render anyway.
const subscribeNothing = () => () => {};

/**
 * Offers once, right after a password sign-in, to add a passkey: only when the server and the
 * browser support passkeys, the account has none yet, and it has not answered the offer in
 * this browser before. Adding one or choosing "Not now" ends the offer for good.
 */
export default function PasskeyOffer() {
  const user = useUser();
  const serverSupportsPasskeys = useConfirmedFeature(
    (features) => features.passkey === true,
  );
  const pending = useSyncExternalStore(
    subscribeNothing,
    isPasskeyOfferPending,
    () => false,
  );
  const [answered, setAnswered] = useState(false);

  const applies =
    pending &&
    serverSupportsPasskeys &&
    user !== null &&
    browserSupportsPasskeys() &&
    !isPasskeyOfferDone(user.id);
  const { data: passkeys } = usePasskeys({ enabled: applies });

  const hasPasskey = passkeys !== undefined && passkeys.length > 0;
  const open = applies && !answered && passkeys !== undefined && !hasPasskey;

  // Not for this account (it has a passkey, the browser has no support, it answered before):
  // drop the mark so a later page does not offer it either. Waits for the instance and the
  // session, which arrive after the first render.
  const settledWithoutOffer =
    pending &&
    serverSupportsPasskeys &&
    user !== null &&
    (!applies || hasPasskey);
  useEffect(() => {
    if (settledWithoutOffer) clearPasskeyOfferPending();
  }, [settledWithoutOffer]);

  const finish = () => {
    if (user) markPasskeyOfferDone(user.id);
    clearPasskeyOfferPending();
    setAnswered(true);
  };

  return open ? <PasskeyOfferDialog onDone={finish} /> : null;
}

function PasskeyOfferDialog({ onDone }: { onDone: () => void }) {
  const t = useTranslations();
  const add = useAddPasskey();

  const onAdd = async () => {
    try {
      await add.mutateAsync();
      toast.success(t("passkeys-added"));
      onDone();
    } catch (error) {
      if (isPasskeyCancelled(error)) return;
      toast.error(
        t(
          isSessionNotFresh(error)
            ? "passkeys-error-session-not-fresh"
            : "passkeys-error-add",
        ),
      );
    }
  };

  return (
    <DrawerDialog
      open
      onOpenChange={(next) => !next && onDone()}
      title={t("passkeys-offer-title")}
      description={t("passkeys-offer-description")}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onDone}>
            {t("passkeys-offer-dismiss")}
          </Button>
          <Button
            type="button"
            loading={add.isPending}
            disabled={add.isPending}
            onClick={() => void onAdd()}
          >
            {t("passkeys-offer-add")}
          </Button>
        </>
      }
    />
  );
}
