import { NextResponse } from 'next/server';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '50', 10);

    // Simulate API authorization check
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return NextResponse.json({ error: "Unauthorized. Missing static API key." }, { status: 401 });
    }

    // Simulate Network Latency
    await new Promise(resolve => setTimeout(resolve, 800));

    const totalOrders = 150; // We'll simulate 150 total orders
    const totalPages = Math.ceil(totalOrders / limit);

    if (page > totalPages) {
        return NextResponse.json({
            data: [],
            meta: { page, limit, totalPages, totalRecords: totalOrders, hasMore: false }
        });
    }

    // Generate deterministic mock data based on page number
    const orders = Array.from({ length: limit }, (_, i) => {
        const orderIndex = (page - 1) * limit + i + 1;
        if (orderIndex > totalOrders) return null;

        return {
            order_id: `SHP-${100000 + orderIndex}`,
            customer_name: `Shopper ${orderIndex}`,
            status: orderIndex % 5 === 0 ? "SHIPPED" : "COMPLETED",
            total_amount: +(Math.random() * 200 + 15).toFixed(2),
            currency: "USD",
            items_count: Math.floor(Math.random() * 5) + 1,
            created_at: new Date(Date.now() - orderIndex * 3600000).toISOString()
        };
    }).filter(Boolean);

    return NextResponse.json({
        data: orders,
        meta: {
            page,
            limit,
            totalPages,
            totalRecords: totalOrders,
            hasMore: page < totalPages
        }
    });
}
