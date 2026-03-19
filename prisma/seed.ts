import prisma from '../src/lib/prisma'

async function main() {
    console.log('Start seeding...')

    // 1. Create User
    const user = await prisma.user.upsert({
        where: { email: 'jane@acme.co' },
        update: {},
        create: {
            email: 'jane@acme.co',
            name: 'Jane Taylor',
            image: ''
        },
    })
    console.log(`Created User: ${user.name}`)

    // 2. Create Workspace
    const workspace = await prisma.workspace.upsert({
        where: { slug: 'acme-corp' },
        update: {},
        create: {
            name: 'Acme Corp',
            slug: 'acme-corp',
            ownerId: user.id,
            members: {
                create: {
                    userId: user.id,
                    role: 'owner'
                }
            }
        },
    })
    console.log(`Created Workspace: ${workspace.name}`)

    // 3. Create Connections (Sources & Destinations)
    const shopeeSource = await prisma.connection.create({
        data: {
            workspaceId: workspace.id,
            name: 'Shopee SG',
            type: 'source',
            provider: 'shopee',
            credentials: '{}',
            status: 'connected'
        }
    })

    const fbAdsSource = await prisma.connection.create({
        data: {
            workspaceId: workspace.id,
            name: 'FB Ads APAC',
            type: 'source',
            provider: 'facebook',
            credentials: '{}',
            status: 'connected'
        }
    })

    const postgresDest = await prisma.connection.create({
        data: {
            workspaceId: workspace.id,
            name: 'Production DWH',
            type: 'destination',
            provider: 'postgres',
            credentials: '{}',
            status: 'connected'
        }
    })
    console.log(`Created Connections`)

    // 4. Create Pipelines
    const pipeline1 = await prisma.pipeline.create({
        data: {
            workspaceId: workspace.id,
            name: 'Shopee Orders to Postgres',
            sourceConnectionId: shopeeSource.id,
            destinationConnectionId: postgresDest.id,
            scheduleCron: '0 * * * *',
            status: 'active',
            lastSyncedAt: new Date(Date.now() - 5 * 60000), // 5 mins ago
            logs: {
                create: [
                    { status: 'success', rowsSynced: 14028, durationMs: 4500 }
                ]
            }
        }
    })

    const pipeline2 = await prisma.pipeline.create({
        data: {
            workspaceId: workspace.id,
            name: 'FB Campaign ROAS',
            sourceConnectionId: fbAdsSource.id,
            destinationConnectionId: postgresDest.id,
            scheduleCron: '0 0 * * *', // Daily
            status: 'active',
            lastSyncedAt: new Date(Date.now() - 2 * 3600000), // 2 hours ago
            logs: {
                create: [
                    { status: 'success', rowsSynced: 450, durationMs: 1200 }
                ]
            }
        }
    })
    console.log(`Created Pipelines`)

    console.log('Seeding finished.')
}

main()
    .then(async () => {
        await prisma.$disconnect()
    })
    .catch(async (e) => {
        console.error(e)
        await prisma.$disconnect()
        process.exit(1)
    })
