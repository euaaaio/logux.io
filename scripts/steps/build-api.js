import { join, dirname, sep } from 'path'
import { promises as fs } from 'fs'
import remarkHighlight from 'remark-highlight.js'
import remarkRehype from 'remark-rehype'
import makeDir from 'make-dir'
import slugify from 'slugify'
import remark from 'remark'

import { step } from '../lib/spinner.js'
import { DIST } from '../lib/dirs.js'

const CAPITALIZED = /^[A-Z]/

const KINDS = [
  ['Functions', i => i.kindString === 'Function'],
  ['Variables', i => i.kindString === 'Variable' && i.name !== 'WebSocket'],
  ['Types', i => i.kindString === 'Type alias' || i.kindString === 'Interface']
]

const EXTERNAL_TYPES = {
  Reducer: 'https://redux.js.org/basics/reducers/',
  StoreEnhancer: 'https://redux.js.org/advanced/middleware',
  PreloadedState:
    'https://redux.js.org/recipes/' +
    'structuring-reducers/initializing-state/',
  ReduxStore: 'https://redux.js.org/basics/store',
  Partial:
    'https://www.typescriptlang.org/docs/handbook/' +
    'utility-types.html#partialt',
  ReturnType:
    'https://www.typescriptlang.org/docs/handbook/' +
    'utility-types.html#returntypet',
  Promise:
    'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/' +
    'Using_promises',
  Observable: 'https://github.com/tc39/proposal-observable',
  ReduxContext: 'https://react-redux.js.org/using-react-redux/accessing-store',
  Process: 'https://nodejs.org/api/process.html#process_process',
  HTTPServer: 'https://nodejs.org/api/http.html#http_class_http_server',
  Unsubscribe: 'https://github.com/ai/nanoevents/#remove-listener',
  Component: 'https://reactjs.org/docs/react-component.html',
  ActionTree: 'https://vuex.vuejs.org/guide/hot-reload.html',
  GetterTree: 'https://vuex.vuejs.org/guide/hot-reload.html',
  ModuleTree: 'https://vuex.vuejs.org/guide/hot-reload.html',
  MutationTree: 'https://vuex.vuejs.org/guide/hot-reload.html',
  WebSocket: 'https://developer.mozilla.org/en-US/docs/Web/API/WebSocket',
  Map:
    'https://developer.mozilla.org/en-US/docs/Web/JavaScript/' +
    'Reference/Global_Objects/Map',
  VuexDispatch: 'https://vuex.vuejs.org/api/#dispatch',
  Module: 'https://vuex.vuejs.org/guide/modules.html',
  ModuleOptions: 'https://vuex.vuejs.org/guide/modules.html#preserving-state',
  VuexStoreOptions:
    'https://vuex.vuejs.org/api/#vuex-store-constructor-options',
  VuexStore: 'https://vuex.vuejs.org/api/#vuex-store',
  SubscribeActionOptions: 'https://vuex.vuejs.org/api/#subscribeaction',
  WatchOptions: 'https://vuex.vuejs.org/api/#watch',
  CommitOptions: 'https://vuex.vuejs.org/api/#commit',
  SubscribeOptions: 'https://vuex.vuejs.org/api/#subscribe',
  ComponentType:
    'https://github.com/DefinitelyTyped/DefinitelyTyped/blob/' +
    'master/types/react/index.d.ts#L81',
  App: 'https://v3.vuejs.org/api/global-api.html#createapp',
  InjectionKey: 'https://v3.vuejs.org/api/composition-api.html#provide-inject',
  Ref: 'https://v3.vuejs.org/api/refs-api.html#ref',
  ComputedGetter: 'https://v3.vuejs.org/api/computed-watch-api.html#computed',
  ComputedRef: 'https://v3.vuejs.org/api/computed-watch-api.html#computed',
  VuexPayload: 'https://vuex.vuejs.org/guide/mutations.html#commit-with-payload'
}

const SIMPLE_TYPES = new Set([
  'WebSocket',
  'RegExp',
  'Error',
  'Array',
  'function',
  'boolean',
  'string',
  'object',
  'number',
  'any',
  'ExtendedVue',
  'Store'
])

const HIDE_CONSTRUCTOR = new Set([
  'ChannelContext',
  'Context',
  'ServerClient',
  'TestLog'
])

const TEMPLATELESS = new Set(['ActionIterator', 'ActionListener', 'Log'])

const INLINE_TYPES = new Set(['NodeState'])

const EMPTY = { type: 'text', value: '' }
const OPTIONAL = [
  { type: 'text', value: ' ' },
  {
    type: 'element',
    tagName: 'span',
    properties: { 'aria-title': 'Optional' },
    children: [{ type: 'text', value: '?' }]
  }
]

function toSlug (type) {
  let slug = type
  if (!CAPITALIZED.test(slug)) slug = 'globals-' + slug
  return slugify(slug).toLowerCase()
}

function byTypeAndName (a, b) {
  if (a.kindString === 'Method' && b.kindString !== 'Method') {
    return 1
  } else if (a.kindString !== 'Method' && b.kindString === 'Method') {
    return -1
  } else {
    return byName(a, b)
  }
}

function byName (a, b) {
  if (CAPITALIZED.test(a.name) && !CAPITALIZED.test(b.name)) {
    return -1
  } else if (!CAPITALIZED.test(a.name) && CAPITALIZED.test(b.name)) {
    return 1
  } else {
    return a.name.localeCompare(b.name)
  }
}

function tag (tagName, children, opts) {
  if (!Array.isArray(children)) {
    children = [children]
  }
  children = children.map(i => {
    return typeof i === 'string' ? { type: 'text', value: i } : i
  })
  return { type: 'element', tagName, properties: {}, children, ...opts }
}

function toHtml (content) {
  if (!content) return []
  content = content.replace(/{@link [\w#.]+}/g, str => {
    let name = str.slice(7, -1)
    let link = name.toLowerCase().replace('#', '-')
    if (!CAPITALIZED.test(name)) link = 'globals-' + link
    return `[\`${name}\`](#${link})`
  })
  let tree = remark().parse(content)
  remarkHighlight({ prefix: 'code-block_' })(tree)
  return remarkRehype()(tree).children
}

function toText (nodes) {
  return nodes
    .map(node => {
      if (node.type === 'text') {
        return node.value
      } else if (node.children) {
        return toText(node.children)
      } else {
        return ''
      }
    })
    .join('')
}

function joinTags (separator, tags) {
  return tags.flatMap((el, index) => {
    if (index === tags.length - 1) {
      return el
    } else {
      return [...el, { type: 'text', value: separator }]
    }
  })
}

function declHtml (ctx, decl) {
  let type = []
  if (decl.type) {
    type = typeHtml(ctx, decl.type)
  } else if (decl.children) {
    type = joinTags(
      ', ',
      decl.children.map(i => declHtml(ctx, i))
    )
  } else if (decl.indexSignature) {
    let index = decl.indexSignature
    type = [
      { type: 'text', value: `[${index.parameters[0].name}: ` },
      ...typeHtml(ctx, index.parameters[0].type),
      { type: 'text', value: ']: ' },
      ...typeHtml(ctx, index.type)
    ]
  } else if (decl.signatures) {
    if (decl.signatures[0].parameters) {
      let signature = decl.signatures[0]
      type = [
        { type: 'text', value: '(' },
        ...joinTags(
          ', ',
          signature.parameters.map(i => declHtml(ctx, i))
        ),
        { type: 'text', value: ') => ' },
        ...typeHtml(ctx, signature.type)
      ]
    } else {
      type = [
        { type: 'text', value: '() => ' },
        ...typeHtml(ctx, decl.signatures[0].type)
      ]
    }
  }
  if (decl.name === '__type' && decl.signatures) {
    return type
  } else if (decl.name === '__type' && type.length === 0) {
    return [{ type: 'text', value: '{ }' }]
  } else if (decl.name === '__type') {
    return [
      { type: 'text', value: '{ ' },
      ...type,
      { type: 'text', value: ' }' }
    ]
  } else {
    let name = decl.name
    if (decl.flags.isOptional) name += '?'
    return [{ type: 'text', value: name + ': ' }, ...type]
  }
}

function typeHtml (ctx, type) {
  if (!type) {
    return []
  } else if (type.type === 'reference') {
    if (INLINE_TYPES.has(type.name)) {
      return typeHtml(ctx, type.reflection.type)
    }
    let result
    if (SIMPLE_TYPES.has(type.name)) {
      result = [{ type: 'text', value: type.name }]
    } else if (EXTERNAL_TYPES[type.name]) {
      result = [
        tag('a', type.name, {
          properties: { href: EXTERNAL_TYPES[type.name] }
        })
      ]
    } else {
      result = [
        tag('a', type.name, {
          properties: { href: '#' + toSlug(type.name) }
        })
      ]
    }
    if (type.typeArguments && !TEMPLATELESS.has(type.name)) {
      let body = joinTags(
        ', ',
        type.typeArguments.map(i => typeHtml(ctx, i))
      )
      let open = '<'
      if (toText(body).length > 25) open = ' <'
      result.push({ type: 'text', value: open }, ...body, {
        type: 'text',
        value: '>'
      })
    }
    return result
  } else if (type.type === 'stringLiteral') {
    return [
      tag('span', `'${type.value}'`, {
        properties: { className: ['code-block_string'] }
      })
    ]
  } else if (type.type === 'intrinsic' || type.type === 'typeParameter') {
    if (type.name === 'M') {
      if (ctx.file === 'node-api') {
        return typeHtml(ctx, { type: 'reference', name: 'ServerMeta' })
      } else {
        return typeHtml(ctx, { type: 'reference', name: 'ClientMeta' })
      }
    }
    return [{ type: 'text', value: type.name }]
  } else if (type.type === 'indexedAccess') {
    return [
      ...typeHtml(ctx, type.objectType),
      { type: 'text', value: '[' },
      ...typeHtml(ctx, type.indexType),
      { type: 'text', value: ']' }
    ]
  } else if (type.type === 'union') {
    return joinTags(
      ' | ',
      type.types.map(i => typeHtml(ctx, i))
    )
  } else if (type.type === 'array') {
    return [...typeHtml(ctx, type.elementType), { type: 'text', value: '[]' }]
  } else if (type.type === 'reflection' && type.declaration) {
    return declHtml(ctx, type.declaration)
  } else if (type.type === 'tuple') {
    return [
      { type: 'text', value: '[' },
      ...joinTags(
        ', ',
        type.elements.map(i => typeHtml(ctx, i))
      ),
      { type: 'text', value: ']' }
    ]
  } else if (type.type === 'intersection') {
    return joinTags(
      ' & ',
      type.types.map(i => typeHtml(ctx, i))
    )
  } else if (type.type === 'conditional') {
    return [
      ...typeHtml(ctx, type.checkType),
      { type: 'text', value: ' ? ' },
      ...typeHtml(ctx, type.trueType),
      { type: 'text', value: ' : ' },
      ...typeHtml(ctx, type.falseType)
    ]
  } else if (type.type === 'typeOperator') {
    return [
      tag('span', ` ${type.operator} `, {
        properties: { className: ['code-block_keyword'] }
      }),
      ...typeHtml(ctx, type.target)
    ]
  } else if (type.type === 'query') {
    return [{ type: 'text', value: 'typeof ' }, ...typeHtml(type.queryType)]
  } else {
    console.error(type)
    throw new Error(`Unknown type ${type.type}`)
  }
}

function getEditUrl (file) {
  if (sep !== '\\') file = file.replace(/\\/g, '/')
  let [, name, path] = file.match(/logux-([^/]+)\/(.*)$/)
  return `https://github.com/logux/${name}/edit/master/${path}`
}

function extendsHtml (parentClasses) {
  if (parentClasses) {
    let name = parentClasses[0].name
    let symbol = parentClasses[0].symbolFullyQualifiedName
    let link
    if (symbol.endsWith('/vuex/types/index".Store')) {
      name = 'VuexStore'
    }
    if (SIMPLE_TYPES.has(name)) {
      link = tag('code', name)
    } else if (EXTERNAL_TYPES[name]) {
      link = tag('a', name, { properties: { href: EXTERNAL_TYPES[name] } })
    } else {
      link = tag('a', name, { properties: { href: '#' + name.toLowerCase() } })
    }
    return [tag('p', ['Extends ', link, '.'])]
  } else {
    return []
  }
}

function extractChildren (nodes) {
  if (nodes.length === 0) {
    return []
  } else {
    return nodes[0].children
  }
}

function commentHtml (comment) {
  if (!comment) return []
  return toHtml(comment.shortText + '\n\n' + comment.text)
}

function propTypeHtml (ctx, type) {
  if (!type) return []
  return [
    tag('p', [
      { type: 'text', value: 'Type: ' },
      tag('code', typeHtml(ctx, type), { noClass: true }),
      { type: 'text', value: '. ' }
    ])
  ]
}

function returnsHtml (ctx, node) {
  if (!node.signatures) return []
  let type = node.signatures[0].type
  if (type.name === 'void') return []
  let comment = node.comment || node.signatures[0].comment || {}
  return [
    tag('p', [
      { type: 'text', value: 'Returns ' },
      tag('code', typeHtml(ctx, type), { noClass: true }),
      { type: 'text', value: '. ' },
      ...extractChildren(toHtml(comment.returns || ''))
    ])
  ]
}

function tableHtml (ctx, name, list) {
  let hasDesc = Array.from(list).some(i => i.comment)
  return [
    tag('table', [
      tag('tr', [
        tag('th', name),
        tag('th', 'Type'),
        hasDesc ? tag('th', 'Description') : EMPTY
      ]),
      ...Array.from(list).map(i => {
        let type
        if (i.signatures) {
          let signature = i.signatures[0]
          let params = signature.parameters || []
          type = [
            { type: 'text', value: '(' },
            ...joinTags(
              ', ',
              params.map(param => declHtml(ctx, param))
            ),
            { type: 'text', value: ') => ' },
            ...typeHtml(ctx, signature.type)
          ]
        } else {
          type = typeHtml(ctx, i.type)
        }
        return tag('tr', [
          tag('td', [
            tag('code', i.name),
            ...(i.flags.isOptional ? OPTIONAL : [EMPTY])
          ]),
          tag('td', [tag('code', type, { noClass: true })]),
          hasDesc ? tag('td', extractChildren(commentHtml(i.comment))) : EMPTY
        ])
      })
    ])
  ]
}

function methodArgs (node) {
  if (!node.signatures[0].parameters) return '()'
  let args = node.signatures[0].parameters
    .map(i => i.name + (i.flags.isOptional ? '?' : ''))
    .join(', ')
  return `(${args})`
}

function paramsHtml (ctx, node) {
  if (!node.signatures) return []
  return node.signatures
    .filter(i => i.parameters)
    .flatMap(i => tableHtml(ctx, 'Parameter', i.parameters))
}

function templatesHtml (ctx, node) {
  if (!node.signatures) return []
  let templates = node.signatures.filter(
    signature =>
      signature.typeParameters &&
      signature.typeParameters.some(type => type.comment)
  )
  if (templates.length > 0) {
    return [
      tag('p', 'Type templates for TypeScript:'),
      ...templates.map(i => {
        return tableHtml(ctx, 'Templates', i.typeParameters)[0]
      })
    ]
  } else {
    return []
  }
}

function membersHtml (ctx, className, members, separator) {
  if (!members) return []
  let slugSep = separator === '#' ? '-' : separator
  return members
    .filter(i => i.name !== 'constructor' && i.name !== 'Error')
    .sort(byTypeAndName)
    .map(member => {
      let name = [
        tag('span', className + separator, {
          properties: { className: ['title_extra'] }
        }),
        { type: 'text', value: member.name }
      ]
      if (member.kindString === 'Method') {
        name.push(
          tag('span', methodArgs(member), {
            properties: { className: ['title_extra'] }
          })
        )
      }
      let comment = member.comment
      if (!comment && member.signatures) {
        comment = member.signatures[0].comment
      }
      return tag('section', [
        tag('h2', [tag('code', name, { noClass: true })], {
          slug: (className + slugSep + member.name).toLowerCase()
        }),
        ...commentHtml(comment),
        ...propTypeHtml(ctx, member.type),
        ...paramsHtml(ctx, member),
        ...templatesHtml(ctx, member),
        ...returnsHtml(ctx, member)
      ])
    })
}

function classHtml (ctx, cls) {
  let hideConstructore = HIDE_CONSTRUCTOR.has(cls.name)
  let statics = cls.children.filter(i => i.flags.isStatic)
  let instance = cls.children.filter(i => !statics.includes(i))
  return tag('article', [
    tag('h1', cls.name, {
      editUrl: getEditUrl(cls.sources[0].fileName)
    }),
    ...extendsHtml(cls.extendedTypes),
    ...commentHtml(cls.comment),
    ...(hideConstructore ? [] : paramsHtml(ctx, cls.groups[0].children[0])),
    ...membersHtml(ctx, cls.name, statics, '.'),
    ...membersHtml(ctx, cls.name, instance, '#')
  ])
}

function functionHtml (ctx, node) {
  return tag('section', [
    tag(
      'h2',
      [
        tag(
          'code',
          [
            { type: 'text', value: node.name },
            tag('span', methodArgs(node), {
              properties: { className: ['title_extra'] }
            })
          ],
          { noClass: true }
        )
      ],
      {
        slug: toSlug(node.name)
      }
    ),
    ...commentHtml(node.signatures[0].comment),
    ...paramsHtml(ctx, node),
    ...returnsHtml(ctx, node),
    ...membersHtml(ctx, node.name, node.children, '#')
  ])
}

function getChildren (type) {
  if (type.name === 'Omit') {
    return getChildren(type.typeArguments[0]).filter(i => {
      return type.typeArguments[1].types.every(j => j.value !== i.name)
    })
  } else {
    return type.reflection.type.declaration.children
  }
}

function variableHtml (ctx, node) {
  let body = []
  if (node.type) {
    let type = node.type
    if (
      type.declaration &&
      type.declaration.children &&
      type.declaration.children[0].comment
    ) {
      body = tableHtml(ctx, 'Property', type.declaration.children)
    } else if (
      type.types &&
      type.types[1].declaration &&
      type.types[1].declaration.children &&
      type.types[1].declaration.children[0].comment
    ) {
      body = tableHtml(ctx, 'Property', [
        ...getChildren(type.types[0]),
        ...type.types[1].declaration.children
      ])
      if (
        type.types[0].reflection &&
        !INLINE_TYPES.has(type.types[0].reflection.type.name)
      ) {
        body = [
          tag('p', [
            { type: 'text', value: 'Extends ' },
            ...typeHtml(ctx, type.types[0]),
            { type: 'text', value: '.' }
          ]),
          ...body
        ]
      }
    } else {
      body = propTypeHtml(ctx, type)
    }
  }
  return tag('section', [
    tag(
      'h2',
      [tag('code', [{ type: 'text', value: node.name }], { noClass: true })],
      {
        slug: toSlug(node.name)
      }
    ),
    ...commentHtml(node.comment),
    ...body
  ])
}

function toTree (ctx, nodes) {
  nodes = nodes.filter(i => !INLINE_TYPES.has(i.name))
  let tree = {
    type: 'root',
    children: nodes
      .filter(i => i.kindString === 'Class')
      .sort(byName)
      .map(i => classHtml(ctx, i))
  }
  for (let [title, filter] of KINDS) {
    let items = nodes.filter(filter)
    if (items.length > 0) {
      tree.children.push(
        tag('article', [
          tag('h1', title, { noSlug: true }),
          ...items
            .sort(byName)
            .filter(i => !SIMPLE_TYPES.has(i.name))
            .map(i => {
              if (i.signatures) {
                return functionHtml(ctx, i)
              } else {
                return variableHtml(ctx, i)
              }
            })
        ])
      )
    }
  }
  return tree
}

function submenuName (node) {
  return node.name + (node.kind === 'function' ? '()' : '')
}

function toSubmenu (nodes) {
  let submenu = nodes
    .filter(i => i.kindString === 'Class')
    .sort(byName)
    .map(cls => ({
      code: cls.name,
      link: '#' + cls.name.toLowerCase()
    }))
  for (let [title, filter] of KINDS) {
    if (title !== 'Types') {
      let items = nodes.filter(filter).sort(byName)
      if (items.length > 0) {
        submenu.push({
          text: title,
          ul: items.map(i => {
            return { code: submenuName(i), link: '#' + toSlug(i.name) }
          })
        })
      }
    }
  }
  return submenu
}

export default async function buildApi (assets, layout, title, nodes) {
  let file = title.replace(/\s/g, '-').toLowerCase()
  let path = join(DIST, file, 'index.html')

  let end = step(`Building ${title} HTML`)
  let ctx = { file }

  await makeDir(dirname(path))
  let tree = toTree(ctx, nodes)
  let submenu = toSubmenu(nodes)
  let html = await layout(`/${file}/`, submenu, title + ' / ', tree)
  await fs.writeFile(path, html)
  assets.add(path, html)

  end()
}
