# Payments Checklist

- Treat client-provided price, role, plan, and entitlement values as untrusted.
- Verify payment status and subscription state server-side via provider APIs or signed webhooks.
- Validate webhook signatures and reject replayed or malformed events.
- Keep payment provider secrets only on the server.
- Store only necessary payment metadata. Do not store card data.
- Test failed payment, refund, cancellation, duplicate webhook, and plan downgrade behavior.
