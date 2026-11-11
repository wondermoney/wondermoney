import { DI } from '@app/app';
import { setTenantContext } from '@app/database/filters/tenant-filter';
import { Appuser } from '@entity/Appuser';
import { AppuserTenant } from '@entity/AppuserTenant';
import { Tenant } from '@entity/Tenant';

import type { AiToolContext } from './ai-tool-types';

export interface AiToolViewer {
  appuser: Appuser;
  tenant: Tenant;
}

/**
 * The rows every tool needs: the caller and their household.
 *
 * Loaded once per context object (one chat turn, one MCP request) and cached, so a model that
 * calls five tools in one turn does not re-read the same two rows five times. A missing row
 * returns `null`; each tool then answers with its empty shape rather than throwing.
 */
const viewers = new WeakMap<AiToolContext, Promise<AiToolViewer | null>>();

export function loadAiToolViewer(context: AiToolContext): Promise<AiToolViewer | null> {
  const cached = viewers.get(context);
  if (cached) return cached;

  const pending = (async (): Promise<AiToolViewer | null> => {
    const appuser = await DI.em.findOne(
      Appuser,
      { appuserKey: context.appuserKey },
      { populate: ['currencyKey'] },
    );
    if (!appuser) return null;
    const tenant = await DI.em.findOne(Tenant, { tenantKey: context.tenantKey });
    if (!tenant) return null;

    // The caller must still be an active member of that household. A token whose member left
    // stops working here even if a caller skipped `authenticateApiToken`.
    const membership = await DI.em.findOne(AppuserTenant, {
      appuserKey: appuser,
      recordActive: true,
      tenantKey: tenant,
    });
    if (!membership) return null;

    /*
     * Arm the tenant filter and its per-account privacy carve-out on the request EM. The
     * assistant and MCP stacks already do this before the tools run; repeating it here keeps
     * the shared layer safe on its own, so a future caller cannot read a partner's private
     * account by forgetting one middleware.
     */
    setTenantContext(DI.em, { appuserKey: appuser.appuserKey, tenantKey: tenant.tenantKey });
    return { appuser, tenant };
  })();

  viewers.set(context, pending);
  return pending;
}
