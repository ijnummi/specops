# Acme Checkout Sample

Small TypeScript codebase for trying the SpecOps "existing project" flow.

The project intentionally starts without a `specops/` folder. Use the walkthrough in
`docs/walkthroughs/analyze-existing-project.md` to register it in SpecOps Workbench,
run Analyze Project, accept a base spec, and inspect source links plus source/spec
annotations.

## Source Map

- `src/cart.ts`: cart item and cart summary domain types.
- `src/inventory.ts`: inventory reservation service.
- `src/checkout.ts`: checkout service that links cart, payment, and inventory behavior.
- `src/payment.ts`: payment gateway interface and fake gateway implementation.
