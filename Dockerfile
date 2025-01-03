# BUILD
FROM node:22-alpine as builder

WORKDIR /opt/src

RUN apk add --no-cache bash git python3 perl alpine-sdk

COPY kubernetes-web-lightclient-server kubernetes-web-lightclient-server

RUN cd kubernetes-web-lightclient-server && \
    npm ci && \
    npm run build

COPY kubernetes-web-lightclient-web kubernetes-web-lightclient-web

RUN cd kubernetes-web-lightclient-web && \
    npm ci && \
    npm run generate

# RUN
FROM node:22-alpine

RUN apk add --no-cache kubectl

COPY --from=builder /opt/src/kubernetes-web-lightclient-server/node_modules /opt/app/kubernetes-web-lightclient/node_modules
COPY --from=builder /opt/src/kubernetes-web-lightclient-server/dist /opt/app/kubernetes-web-lightclient/dist
COPY --from=builder /opt/src/kubernetes-web-lightclient-web/.output/public /opt/app/kubernetes-web-lightclient/web
COPY kubernetes-web-lightclient-server/config.json /opt/app/kubernetes-web-lightclient/config.json
COPY kubernetes-web-lightclient-server/sql /opt/app/kubernetes-web-lightclient/sql

WORKDIR /opt/app/kubernetes-web-lightclient

CMD [ "dist/app.js" ]