# Infrastructure: Cloud Run (`min-instances=1`) + Cloud CDN Edge Cache

## 1. Deploy Cloud Run with warm instance & session affinity
```bash
gcloud run deploy dankiv-writer-site \
  --source . \
  --region europe-central2 \
  --platform managed \
  --port 3000 \
  --min-instances 1 \
  --max-instances 10 \
  --cpu 1 \
  --memory 1Gi \
  --cpu-boost \
  --session-affinity \
  --allow-unauthenticated
```

Or apply the declarative Knative manifest:
```bash
gcloud run services replace deploy/cloudrun-service.yaml --region europe-central2
```

## 2. Attach Serverless NEG + Cloud CDN in front of Cloud Run
```bash
# 1. Create Serverless NEG pointing to Cloud Run service
gcloud compute network-endpoint-groups create dankiv-writer-serverless-neg \
  --region=europe-central2 \
  --network-endpoint-type=serverless \
  --cloud-run-service=dankiv-writer-site

# 2. Import BackendService with Cloud CDN (`USE_ORIGIN_HEADERS` + `serveWhileStale: 300`)
gcloud compute backend-services import dankiv-writer-backend-service \
  --source=deploy/cdn-loadbalancer.yaml \
  --global

# 3. Create URL map & managed HTTPS proxy / forwarding rule
gcloud compute url-maps create dankiv-writer-url-map \
  --default-service=dankiv-writer-backend-service
```

## 3. Caching Contract Verified Against Express Origin
- `GET /api/home`, `/api/poems/:id/read`, `/api/blog/:id/read`, `/api/users/leaderboard` (anonymous): `Cache-Control: public, max-age=60, stale-while-revalidate=300`
- `GET /api/catalog` (anonymous): `Vary: Authorization, Cookie` + `Cache-Control: public, max-age=60, stale-while-revalidate=300`
- `GET /api/catalog` (authenticated): `Cache-Control: private, max-age=0, must-revalidate`
- `GET /api/selections`, `/api/weekly-highlights`, `/api/radio` (anonymous): `Cache-Control: public, max-age=120, stale-while-revalidate=600`
- `GET /api/chat/messages` (anonymous): `Cache-Control: public, max-age=10, stale-while-revalidate=30`
- `/assets/*` and `/src/assets/*`: `Cache-Control: public, max-age=31536000, immutable`
- `/api/auth/*`, `/api/payments/*`, `/api/author/*`, `/api/guest/*`: `Cache-Control: no-store, no-cache, must-revalidate, private`
