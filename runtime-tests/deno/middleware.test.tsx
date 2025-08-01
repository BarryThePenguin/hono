import { assertEquals, assertMatch } from '@std/assert'
import { dirname, fromFileUrl } from '@std/path'
import { assertSpyCall, assertSpyCalls, spy } from '@std/testing/mock'
import { serveStatic } from '../../src/adapter/deno/index.ts'
import { Hono } from '../../src/hono.ts'
import { basicAuth } from '../../src/middleware/basic-auth/index.ts'
import { jwt } from '../../src/middleware/jwt/index.ts'

// Test just only minimal patterns.
// Because others are already tested well in Cloudflare Workers environment.

Deno.test('Basic Auth Middleware', async () => {
  const app = new Hono()

  const username = 'hono'
  const password = 'ahotproject'

  app.use(
    '/auth/*',
    basicAuth({
      username,
      password,
    })
  )

  app.get('/auth/*', () => new Response('auth'))

  const res = await app.request('http://localhost/auth/a')
  assertEquals(res.status, 401)
  assertEquals(await res.text(), 'Unauthorized')

  const credential = 'aG9ubzphaG90cHJvamVjdA=='

  const req = new Request('http://localhost/auth/a')
  req.headers.set('Authorization', `Basic ${credential}`)
  const resOK = await app.request(req)
  assertEquals(resOK.status, 200)
  assertEquals(await resOK.text(), 'auth')

  const invalidCredential = 'G9ubzphY29vbHByb2plY3Q='

  const req2 = new Request('http://localhost/auth/a')
  req2.headers.set('Authorization', `Basic ${invalidCredential}`)
  const resNG = await app.request(req2)
  assertEquals(resNG.status, 401)
  assertEquals(await resNG.text(), 'Unauthorized')
})

Deno.test('JSX middleware', async () => {
  const app = new Hono()
  app.get('/', (c) => {
    return c.html(<h1>Hello</h1>)
  })
  const res = await app.request('http://localhost/')
  assertEquals(res.status, 200)
  assertEquals(res.headers.get('Content-Type'), 'text/html; charset=UTF-8')
  assertEquals(await res.text(), '<h1>Hello</h1>')

  // Fragment
  const template = (
    <>
      <p>1</p>
      <p>2</p>
    </>
  )
  assertEquals(template.toString(), '<p>1</p><p>2</p>')
})

Deno.test('Serve Static middleware', async () => {
  const app = new Hono()
  const onNotFound = spy(() => {})
  app.all('/favicon.ico', serveStatic({ path: './runtime-tests/deno/favicon.ico' }))
  app.all(
    '/favicon-notfound.ico',
    serveStatic({ path: './runtime-tests/deno/favicon-notfound.ico', onNotFound })
  )
  app.use('/favicon-notfound.ico', async (c, next) => {
    await next()
    c.header('X-Custom', 'Deno')
  })

  app.get(
    '/static/*',
    serveStatic({
      root: './runtime-tests/deno',
      onNotFound,
    })
  )

  app.get(
    '/dot-static/*',
    serveStatic({
      root: './runtime-tests/deno',
      rewriteRequestPath: (path) => path.replace(/^\/dot-static/, './.static'),
    })
  )

  app.get('/static-absolute-root/*', serveStatic({ root: dirname(fromFileUrl(import.meta.url)) }))

  let res = await app.request('http://localhost/favicon.ico')
  assertEquals(res.status, 200)
  assertEquals(res.headers.get('Content-Type'), 'image/x-icon')
  await res.body?.cancel()

  res = await app.request('http://localhost/favicon-notfound.ico')
  assertEquals(res.status, 404)
  assertMatch(res.headers.get('Content-Type') || '', /^text\/plain/)
  assertEquals(res.headers.get('X-Custom'), 'Deno')
  assertSpyCall(onNotFound, 0)

  res = await app.request('http://localhost/static/plain.txt')
  assertEquals(res.status, 200)
  assertMatch(await res.text(), /^Deno!(\r?\n)?$/)

  res = await app.request('http://localhost/static/download')
  assertEquals(res.status, 200)
  assertMatch(await res.text(), /^download(\r?\n)?$/)

  res = await app.request('http://localhost/dot-static/plain.txt')
  assertEquals(res.status, 200)
  assertMatch(await res.text(), /^Deno!!(\r?\n)?$/)
  assertSpyCalls(onNotFound, 1)

  res = await app.fetch({
    method: 'GET',
    url: 'http://localhost/static/%2e%2e/static/plain.txt',
  } as Request)
  assertEquals(res.status, 404)
  assertEquals(await res.text(), '404 Not Found')

  res = await app.request('http://localhost/static/helloworld')
  assertEquals(res.status, 200)
  assertEquals(await res.text(), 'Hi\n')

  res = await app.request('http://localhost/static/hello.world')
  assertEquals(res.status, 200)
  assertEquals(await res.text(), 'Hi\n')

  res = await app.request('http://localhost/static-absolute-root/plain.txt')
  assertEquals(res.status, 200)
  assertMatch(await res.text(), /^Deno!(\r?\n)?$/)

  res = await app.request('http://localhost/static')
  assertEquals(res.status, 404)
  assertEquals(await res.text(), '404 Not Found')

  res = await app.request('http://localhost/static/dir')
  assertEquals(res.status, 404)
  assertEquals(await res.text(), '404 Not Found')

  res = await app.request('http://localhost/static/helloworld/nested')
  assertEquals(res.status, 404)
  assertEquals(await res.text(), '404 Not Found')

  res = await app.request('http://localhost/static/helloworld/../')
  assertEquals(res.status, 404)
  assertEquals(await res.text(), '404 Not Found')
})

Deno.test('JWT Authentication middleware', async () => {
  const app = new Hono<{ Variables: { 'x-foo': string } }>()
  app.use('/*', async (c, next) => {
    await next()
    c.header('x-foo', c.get('x-foo') || '')
  })
  app.use('/auth/*', jwt({ secret: 'a-secret' }))
  app.get('/auth/*', (c) => {
    c.set('x-foo', 'bar')
    return new Response('auth')
  })

  const req = new Request('http://localhost/auth/a')
  const res = await app.request(req)
  assertEquals(res.status, 401)
  assertEquals(await res.text(), 'Unauthorized')
  assertEquals(res.headers.get('x-foo'), '')

  const credential =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJtZXNzYWdlIjoiaGVsbG8gd29ybGQifQ.B54pAqIiLbu170tGQ1rY06Twv__0qSHTA0ioQPIOvFE'
  const reqOK = new Request('http://localhost/auth/a')
  reqOK.headers.set('Authorization', `Bearer ${credential}`)
  const resOK = await app.request(reqOK)
  assertEquals(resOK.status, 200)
  assertEquals(await resOK.text(), 'auth')
  assertEquals(resOK.headers.get('x-foo'), 'bar')
})
