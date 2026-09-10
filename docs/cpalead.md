# CPAlead Offerwall integration

## Offerwall

SikkaPlay CPAlead Offerwall slug: `f4a8`

Direct wall URL:

`https://www.cdndn.com/wall/f4a8`

SikkaPlay passes the logged-in user UUID as `subid`:

`https://www.cdndn.com/wall/f4a8?subid=<USER_UUID>`

The CPAlead wall is currently configured for `Sikka` and `85000` points per `$1.00` payout, matching the temporary test economy of `$1 = ₹85` and `₹1 = 1000 Sikka`.

## Postback

Backend endpoint:

`https://sikkaplay-backend-834810172223.asia-south1.run.app/api/callbacks/cpalead`

Recommended CPAlead postback URL:

`https://sikkaplay-backend-834810172223.asia-south1.run.app/api/callbacks/cpalead?subid={subid}&lead_id={lead_id}&campaign_id={campaign_id}&campaign_name={campaign_name}&payout={payout}&event_key={event_key}&event_name={event_name}&event_payout={event_payout}&country_iso={country_iso}&password={password}`

Required Cloud Run environment variables:

- `CPALEAD_POSTBACK_PASSWORD` — the postback password configured in CPAlead. Do not commit the value.
- `CPALEAD_POINTS_PER_USD=85000` — must match the Offerwall's current `Points per $1.00 payout` setting.

The handler validates the CPAlead postback password, accepts CPAlead's publisher relay IP `34.69.179.33`, uses `subid` to identify the SikkaPlay user, converts `payout` to Sikka using `CPALEAD_POINTS_PER_USD`, and stores `lead_id` as the idempotency key so retries cannot double-credit a user.

Do not reward on clicks or client-side completion claims; only a valid server-to-server postback credits Sikka.
