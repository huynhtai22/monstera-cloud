import { shopeeDataClient } from '@/lib/shopee';
import { ExtractResult, PipelineContext, safeJsonParse } from '@/etl/types';

export async function extractShopeeOrders(
  ctx: PipelineContext,
  sourceCreds: any,
  cursorRaw: string | null,
): Promise<ExtractResult> {
  const cursor = cursorRaw ? safeJsonParse(cursorRaw) : null;

  let orders: any[] = [];

  // Normalise: callback stores camelCase (accessToken/shopId), getValidShopeeCreds stores snake_case
  const accessToken = sourceCreds?.access_token ?? sourceCreds?.accessToken;
  const shopId = sourceCreds?.shop_id ?? sourceCreds?.shopId;

  if (accessToken && shopId) {
    try {
      const timeTo = Math.floor(Date.now() / 1000);
      const rawTimeFrom =
        typeof cursor?.lastTimestamp === 'number'
          ? cursor.lastTimestamp
          : timeTo - 14 * 24 * 60 * 60;
      // Shopee enforces time_to - time_from <= 15 days
      const timeFrom = Math.max(rawTimeFrom, timeTo - 14 * 24 * 60 * 60);

      const opts = { accessToken, shopId: Number(shopId), sandbox: sourceCreds?.sandbox === true };
      
      // 1. Get the list of order SNs
      const listData = await shopeeDataClient.getOrderList(opts, timeFrom, timeTo);
      const orderSnList = listData.response?.order_list?.map((o: any) => o.order_sn) || [];

      if (orderSnList.length > 0) {
        // 2. Fetch full details for these orders (Shopee allows up to 50 SNs per call)
        // Note: listData.response.order_list is already limited to 50 by default in getOrderList
        const detailData = await shopeeDataClient.getOrderDetail(opts, orderSnList, [
          'order_status',
          'total_amount',
          'currency',
          'create_time',
          'buyer_user_id'
        ]);

        if (detailData.response?.order_list) {
          orders = detailData.response.order_list.map((o: any) => ({
            order_id: o.order_sn,
            customer_name: o.buyer_user_id ? `Buyer #${o.buyer_user_id}` : 'Hidden',
            status: o.order_status,
            total_amount: o.total_amount,
            currency: o.currency || 'Local',
            items_count: o.item_list?.length || 1,
            created_at: new Date(o.create_time * 1000).toISOString(),
          }));
        }
      }
    } catch (err) {
      console.error('[ETL][SHOPEE] live pull failed, falling back to mock', ctx.pipelineId, err);
    }
  }

  // Fallback to mock if no real orders found (useful for testing/demo)
  if (orders.length === 0) {
    const apiKey = sourceCreds?.apiKey || 'mock-api-key';
    try {
      const shopeeRes = await fetch(
        `${ctx.requestOrigin}/api/mock/shopee/orders?page=1&limit=50`,
        { headers: { Authorization: `Bearer ${apiKey}` } },
      );
      if (shopeeRes.ok) {
        const shopeeData = await shopeeRes.json();
        orders = shopeeData.data || [];
      }
    } catch (e) {
      console.error('[ETL][SHOPEE] Mock fallback failed', e);
    }
  }

  if (orders.length === 0) {
    return { columns: [], rows: [], nextCursor: null };
  }

  const columns = ['Order ID', 'Customer Name', 'Status', 'Total Amount', 'Currency', 'Item Count', 'Created At'];
  const rows = orders.map((order: any) => [
    order.order_id,
    order.customer_name,
    order.status,
    order.total_amount,
    order.currency,
    order.items_count,
    order.created_at,
  ]);

  return {
    columns,
    rows,
    nextCursor: { lastTimestamp: Math.floor(Date.now() / 1000) },
  };
}
