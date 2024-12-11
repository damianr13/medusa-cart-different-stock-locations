import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { InventoryLevel, InventoryTypes, MedusaContainer } from "@medusajs/framework/types"
import seedBase from "../../src/scripts/seed"
import { addToCartWorkflow, createCartWorkflow, createStockLocationsWorkflow, createTaxRatesWorkflow, linkSalesChannelsToStockLocationWorkflow, createProductsWorkflow, createProductCategoriesWorkflow, createInventoryLevelsWorkflow, completeCartWorkflow, createPaymentCollectionForCartWorkflow, createPaymentSessionsWorkflow } from "@medusajs/medusa/core-flows"
import { ContainerRegistrationKeys, remoteQueryObjectFromString, ProductStatus } from "@medusajs/framework/utils"
import { Modules } from "@medusajs/framework/utils"
import { defaultStoreCartFields } from "@medusajs/medusa/api/store/carts/query-config"
import { logger } from "@medusajs/framework"

const cartFormattedFields = defaultStoreCartFields.map((f) => {
  if (f.startsWith("*")) {
    return f.slice(1) + ".*"
  }
  return f
})

async function seed(container: MedusaContainer) {
  const regionModuleService = container.resolve(Modules.REGION)
  const remoteLink = container.resolve(
    ContainerRegistrationKeys.REMOTE_LINK
  );
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const { result: stockLocationResult } = await createStockLocationsWorkflow(
    container
  ).run({
    input: {
      locations: [
        {
          name: "2nd European Warehouse",
          address: {
            city: "Billund",
            country_code: "DK",
            address_1: "",
          },
        },
      ],
    },
  });
  const stockLocation = stockLocationResult[0];

  await remoteLink.create({
    [Modules.STOCK_LOCATION]: {
      stock_location_id: stockLocation.id,
    },
    [Modules.FULFILLMENT]: {
      fulfillment_provider_id: "manual_manual",
    },
  });

  const { data: [defaultSalesChannel] } = await query.graph({
    entity: 'sales_channel',
    fields: ['id'],
    filters: {
      name: 'Default Sales Channel'
    }
  })
  await linkSalesChannelsToStockLocationWorkflow(container).run({
    input: {
      id: stockLocation.id,
      add: [defaultSalesChannel.id],
    },
  });

  // Create product categories
  const { result: categoryResult } = await createProductCategoriesWorkflow(container).run({
    input: {
      product_categories: [
        {
          name: "Hoodies",
          is_active: true,
        },
        {
          name: "Accessories",
          is_active: true,
        },
        // Add other categories if needed
      ],
    },
  });

  // Create new products
  await createProductsWorkflow(container).run({
    input: {
      products: [
        {
          title: "Medusa Hoodie",
          category_ids: [
            categoryResult.find((cat) => cat.name === "Hoodies").id,
          ],
          description:
            "Experience the comfort of our classic hoodie. Perfect for any casual occasion.",
          handle: "hoodie",
          weight: 500,
          status: ProductStatus.PUBLISHED,
          images: [
            {
              url: "https://medusa-public-images.s3.eu-west-1.amazonaws.com/hoodie-front.png",
            },
            {
              url: "https://medusa-public-images.s3.eu-west-1.amazonaws.com/hoodie-back.png",
            },
          ],
          options: [
            {
              title: "Size",
              values: ["S", "M", "L", "XL"],
            },
            {
              title: "Color",
              values: ["Gray", "Black"],
            },
          ],
          variants: [
            {
              title: "S / Gray",
              sku: "HOODIE-S-GRAY",
              options: {
                Size: "S",
                Color: "Gray",
              },
              prices: [
                {
                  amount: 20,
                  currency_code: "eur",
                },
                {
                  amount: 25,
                  currency_code: "usd",
                },
              ],
            },
            // Add more variants as needed
          ],
          sales_channels: [
            {
              id: defaultSalesChannel.id,
            },
          ],
        },
        {
          title: "Medusa Cap",
          category_ids: [
            categoryResult.find((cat) => cat.name === "Accessories").id,
          ],
          description:
            "Top off your look with our stylish cap. A must-have accessory for any wardrobe.",
          handle: "cap",
          weight: 200,
          status: ProductStatus.PUBLISHED,
          images: [
            {
              url: "https://medusa-public-images.s3.eu-west-1.amazonaws.com/cap-front.png",
            },
            {
              url: "https://medusa-public-images.s3.eu-west-1.amazonaws.com/cap-back.png",
            },
          ],
          options: [
            {
              title: "Color",
              values: ["Red", "Blue"],
            },
          ],
          variants: [
            {
              title: "Red",
              sku: "CAP-RED",
              options: {
                Color: "Red",
              },
              prices: [
                {
                  amount: 15,
                  currency_code: "eur",
                },
                {
                  amount: 20,
                  currency_code: "usd",
                },
              ],
            },
            // Add more variants as needed
          ],
          sales_channels: [
            {
              id: defaultSalesChannel.id,
            },
          ],
        },
      ],
    },
  });

  const { data: products } = await query.graph({
    entity: 'product',
    fields: ['id', 'variants.*', 'variants.id', 'variants.inventory_items.*'],
    filters: {
      title: ['Medusa Hoodie', 'Medusa Cap']
    }
  })

  const inventoryLevels: InventoryTypes.CreateInventoryLevelInput[] = []
  for (const product of products) {
    const inventoryItem = product.variants?.[0]?.inventory_items?.[0]
    if (!inventoryItem) {
      throw new Error(`No inventory item found for product ${product.id}`)
    }

    const inventoryLevel = {
      location_id: stockLocation.id,
      stocked_quantity: 1000000,
      inventory_item_id: inventoryItem.inventory_item_id,
    }
    inventoryLevels.push(inventoryLevel)
  }

  await createInventoryLevelsWorkflow(container).run({
    input: {
      inventory_levels: inventoryLevels
    },
  })

  const [defaultRegion] = await regionModuleService.listRegions({}, {
    relations: ["countries"]
  })

  await createCartWorkflow(container).run({
    input: {
      // @ts-ignore - the type checking from medusa does not allow ids but if we set them it works
      id: "example-cart",
      currency_code: "eur",
      region_id: defaultRegion.id,
      country_code: defaultRegion.countries[0].iso_2,
      shipping_address: {
        country_code: defaultRegion.countries[0].iso_2,
      }
    },
  })
  logger.info(`Cart created: example-cart`)

  await createPaymentCollectionForCartWorkflow(container).run({
    input: {
      cart_id: "example-cart",
    },
  })
}

medusaIntegrationTestRunner({
  dbName: process.env.TEST_STATIC_DB_NAME,
  testSuite: async ({ getContainer }) => {
    beforeEach(async () => {
      await seedBase({ container: getContainer(), args: [] })
      await seed(getContainer())
    })
    describe("Test that checking out a cart with different stock locations works", () => {
      test("should complete", async () => {
        const remoteQuery = getContainer().resolve(ContainerRegistrationKeys.REMOTE_QUERY)
        const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)

        const queryObject = remoteQueryObjectFromString({
          entryPoint: "cart",
          variables: { filters: { id: "example-cart" } },
          fields: cartFormattedFields
        })

        const [cart] = await remoteQuery(queryObject)
        const products = await query.graph({
          entity: 'product',
          fields: ['id', 'title', 'variants.*', 'variants.id', 'variants.price_set.*'],
          filters: {
            title: ['Medusa T-Shirt', 'Medusa Hoodie']
          }
        })

        await addToCartWorkflow(getContainer()).run({
          input: {
            cart,
            items: [{
              variant_id: products.data[0].variants[0].id,
              quantity: 1,
            }]
          }
        })
        await addToCartWorkflow(getContainer()).run({
          input: {
            cart,
            items: [{
              variant_id: products.data[1].variants[0].id,
              quantity: 1,
            }]
          }
        })

        const { data: [{ payment_collection: paymentCollection1 }] } = await query.graph({
          entity: "cart",
          fields: ["id", "payment_collection.*"],
          filters: {
            id: "example-cart",
          },
        })

        await createPaymentSessionsWorkflow(getContainer()).run({
          input: {
            payment_collection_id: paymentCollection1?.id,
            provider_id: "pp_system_default",
          },
        })

        await completeCartWorkflow(getContainer()).run({
          input: {
            id: cart.id
          }
        })

        expect(true).toBe(true)
      })
    })
  }
})