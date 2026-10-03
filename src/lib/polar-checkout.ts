import { randomUUID } from "node:crypto";
import type { Checkout } from "@polar-sh/sdk/models/components/checkout";
import prisma from "./prisma";
import { withDatabaseTenantContext } from "./database-tenant-context";
import { canPurchaseAgencyPro } from "./public-plan-catalog";
import { PaymentWorkspaceError } from "./payment-workspace";
import { getPolarClient, polarProductIdForCycle, polarServer, type PolarBillingCycle } from "./polar-billing";
import { PRODUCT_SITE_URL } from "./site-url";

type CheckoutProvider = { get(id: string): Promise<Checkout>; create(nonce: string): Promise<Checkout> };
/** Persist intent before the external call. An ambiguous failure requires review, never another charge session. */
export async function preparePolarCheckout(input: {
  workspaceId: string; userId: string; email: string; cycle: PolarBillingCycle;
}, options: { client?: Pick<typeof prisma, "$transaction">; provider?: CheckoutProvider; now?: Date } = {}): Promise<Checkout> {
  const db=options.client??prisma;
  const productId=polarProductIdForCycle(input.cycle).trim();
  if (!productId) throw new PaymentWorkspaceError("The selected Polar product is not configured.",409);
  const provider=options.provider??{
    get:(id:string)=>getPolarClient().checkouts.get({id},{timeoutMs:5000}),
    create:(nonce:string)=>getPolarClient().checkouts.create({products:[productId],customerEmail:input.email,
      externalCustomerId:input.workspaceId,metadata:{workspace_id:input.workspaceId,initiated_by_user_id:input.userId,billing_cycle:input.cycle,checkout_attempt:nonce},
      successUrl:`${PRODUCT_SITE_URL}/settings?billing=polar-return`,returnUrl:`${PRODUCT_SITE_URL}/pricing`,
    },{timeoutMs:5000,retries:{strategy:"none"}}),
  };
  const stateId=`polar-checkout-${polarServer()}-${input.workspaceId}`;
  const decision=await withDatabaseTenantContext(db,input.workspaceId,async tx=>{
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`polar:workspace:${input.workspaceId}`},0))`;
    const workspace=await tx.workspace.findUnique({where:{id:input.workspaceId},select:{plan:true,status:true,subscriptionProvider:true,subscriptionEndsAt:true}});
    if(!workspace||!canPurchaseAgencyPro(workspace.plan,workspace.status,{provider:workspace.subscriptionProvider,endsAt:workspace.subscriptionEndsAt})||workspace.subscriptionProvider) {
      throw new PaymentWorkspaceError("This workspace needs a billing review before starting Polar checkout.",409);
    }
    const existing=await tx.auditEvent.findFirst({where:{id:stateId,workspaceId:input.workspaceId},select:{metadata:true}});
    const metadata=existing?.metadata as {checkoutId?:string;cycle?:string;productId?:string}|undefined;
    if(existing){
      if(!metadata?.checkoutId) throw new PaymentWorkspaceError("Checkout preparation needs review. Contact support before trying another payment.",409);
      const checkout=await provider.get(metadata.checkoutId);
      if(checkout.id!==metadata.checkoutId||checkout.externalCustomerId!==input.workspaceId||checkout.metadata.workspace_id!==input.workspaceId) throw new PaymentWorkspaceError("Checkout workspace identity does not match.",409);
      if(checkout.status==="confirmed"||checkout.status==="succeeded") throw new PaymentWorkspaceError("Payment is processing. Wait for your workspace entitlement before paying again.",409);
      if(checkout.status==="open"&&checkout.expiresAt>(options.now??new Date())){
        if(metadata.cycle!==input.cycle||metadata.productId!==productId) throw new PaymentWorkspaceError("An existing checkout uses a different term. Contact support before opening another checkout.",409);
        return {checkout,nonce:null};
      }
      if(checkout.status!=="expired"&&checkout.status!=="failed") throw new PaymentWorkspaceError("Checkout status needs review before another payment.",409);
    }
    const nonce=randomUUID();
    const data={state:"preparing",nonce,cycle:input.cycle,productId};
    if(existing)await tx.auditEvent.updateMany({where:{id:stateId,workspaceId:input.workspaceId},data:{metadata:data}});
    else await tx.auditEvent.create({data:{id:stateId,workspaceId:input.workspaceId,actorUserId:input.userId,action:"billing.polar.checkout",resource:"polar_checkout",metadata:data}});
    return {checkout:null,nonce};
  },{timeout:15000});
  if(decision.checkout)return decision.checkout;
  const checkout=await provider.create(decision.nonce!);
  if(checkout.externalCustomerId!==input.workspaceId||checkout.metadata.workspace_id!==input.workspaceId||checkout.productId!==productId) throw new PaymentWorkspaceError("Created checkout needs identity review before payment.",409);
  await withDatabaseTenantContext(db,input.workspaceId,async tx=>{
    await tx.auditEvent.updateMany({where:{id:stateId,workspaceId:input.workspaceId},data:{metadata:{state:"prepared",nonce:decision.nonce,cycle:input.cycle,productId,checkoutId:checkout.id}}});
  });
  return checkout;
}
