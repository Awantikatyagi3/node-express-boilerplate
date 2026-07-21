FROM node:18-alpine

# Create app directory and set ownership
RUN mkdir -p /usr/src/node-app && chown -R node:node /usr/src/node-app

WORKDIR /usr/src/node-app

# Install dependencies
COPY package.json yarn.lock ./
USER node
RUN yarn install --pure-lockfile

# Copy source code
COPY --chown=node:node . .

EXPOSE 3000

# Start the app (npm start uses the script defined in package.json)
CMD [ npm, start]
