#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

/**
 * DeepAgents 模板打包脚本
 * 将 TS/Python 模板打包成 zip 文件，排除 .gitignore 和开发文件
 */

// 获取命令行参数
const templateName = process.argv[2]
const isRelease = process.argv.includes('--release')

if (!templateName) {
  console.error('❌ 请指定模板名称')
  console.log('用法: node scripts/pack-template.js <template-name> [--release]')
  console.log('可用模板: ts, flow-ts, py, all')
  console.log('  --release  生成稳定文件名（无时间戳），用于发布')
  process.exit(1)
}

// 模板配置
const templates = {
  ts: {
    name: 'TypeScript 模板 (app)',
    dir: 'packages/deepagents-app-ts',
    outputName: 'deepagents-app-ts',
    versionFile: 'package.json',
  },
  'flow-ts': {
    name: 'TypeScript 模板 (flow)',
    dir: 'packages/deepagents-flow-ts',
    outputName: 'deepagents-flow-ts',
    versionFile: 'package.json',
  },
  py: {
    name: 'Python 模板',
    dir: 'packages/deepagents-app-py',
    outputName: 'deepagents-app-py',
    versionFile: 'pyproject.toml',
  },
}

const ROOT_DIR = path.resolve(__dirname, '..')
const outputDir = path.join(ROOT_DIR, 'zip')

// 创建输出目录
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true })
}

/**
 * 读取版本号
 */
function getVersion(template) {
  const filePath = path.join(ROOT_DIR, template.dir, template.versionFile)

  if (!fs.existsSync(filePath)) {
    return null
  }

  const content = fs.readFileSync(filePath, 'utf8')

  if (template.versionFile === 'package.json') {
    try {
      const pkg = JSON.parse(content)
      return pkg.version || null
    } catch {
      return null
    }
  }

  // pyproject.toml
  const match = content.match(/^version\s*=\s*"([^"]+)"/m)
  return match ? match[1] : null
}

/**
 * 生成时间戳 YYYY_MM_DD_HH_MM_SS
 */
function getTimestamp() {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  const h = String(now.getHours()).padStart(2, '0')
  const min = String(now.getMinutes()).padStart(2, '0')
  const s = String(now.getSeconds()).padStart(2, '0')
  return `${y}_${m}_${d}_${h}_${min}_${s}`
}

/**
 * 清除旧的 zip 文件
 */
function cleanOldZips(templateName) {
  if (!fs.existsSync(outputDir)) return

  const files = fs.readdirSync(outputDir)
  const oldFiles = files.filter(file => {
    if (!file.endsWith('.zip')) return false
    const baseName = file.replace(/\.zip$/, '')
    return (
      baseName === templateName ||
      baseName.startsWith(`${templateName}_`)
    )
  })

  if (oldFiles.length > 0) {
    oldFiles.forEach(file => {
      fs.unlinkSync(path.join(outputDir, file))
      console.log(`  🗑️  已删除: ${file}`)
    })
  }
}

/**
 * 读取 .gitignore 排除模式
 */
function getExcludePatterns(templateDir) {
  const gitignorePath = path.join(templateDir, '.gitignore')

  // 强制排除
  const forceExclude = [
    'node_modules',
    '__pycache__',
    '.venv',
    'dist',
    'dist-packages',
    'build',
    '.next',
    '.cache',
    'coverage',
    '*.log',
    '.DS_Store',
    'Thumbs.db',
    '.git',
    '.github',
    '.idea',
    '.vscode',
    '.env',
    '.env.local',
    '*.tgz',
    '*.tar.gz',
    '*.zip',
    '*.pyc',
    '*.egg-info',
    '.pytest_cache',
    '.ruff_cache',
    'uv.lock',
    'agent-package.release.json',
    'code-graph.json',
  ]

  let gitignorePatterns = []
  if (fs.existsSync(gitignorePath)) {
    const content = fs.readFileSync(gitignorePath, 'utf8')
    gitignorePatterns = content
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'))
      .map(pattern => (pattern.endsWith('/') ? pattern.slice(0, -1) : pattern))
  }

  return [...new Set([...forceExclude, ...gitignorePatterns])]
}

/**
 * 打包单个模板
 */
function packTemplate(templateKey) {
  const template = templates[templateKey]
  if (!template) {
    console.error(`❌ 未知模板: ${templateKey}`)
    console.log('可用模板:', Object.keys(templates).join(', '))
    return false
  }

  const templateDir = path.join(ROOT_DIR, template.dir)

  if (!fs.existsSync(templateDir)) {
    console.error(`❌ 模板目录不存在: ${templateDir}`)
    return false
  }

  const version = getVersion(template)
  const timestamp = getTimestamp()

  let fileName
  if (isRelease) {
    if (!version) {
      console.error('❌ Release 模式需要版本号')
      return false
    }
    fileName = `${template.outputName}_${version}_${timestamp}.zip`
  } else {
    fileName = version
      ? `${template.outputName}_${version}_${timestamp}.zip`
      : `${template.outputName}_${timestamp}.zip`
  }

  const outputFile = path.join(outputDir, fileName)

  console.log('')
  console.log(`📦 打包模板: ${template.name}`)
  if (version) console.log(`📌 版本: ${version}`)
  console.log(`📁 源目录: ${templateDir}`)
  console.log(`📄 输出: ${outputFile}`)

  // 清除旧文件
  console.log('')
  console.log('🧹 清除旧文件...')
  cleanOldZips(template.outputName)

  // 构建排除参数
  const excludePatterns = getExcludePatterns(templateDir)
  let excludeArgs = excludePatterns.map(p => `-x "${p}/*" -x "${p}"`).join(' ')

  // 对于 .DS_Store 等文件名模式，需要额外处理
  // 使用 */pattern 来匹配嵌套的文件
  const filePatterns = excludePatterns.filter(p => p.startsWith('*.') || p.startsWith('.'))
  filePatterns.forEach(p => {
    if (!p.includes('/')) {
      excludeArgs += ` -x "*/${p}" -x "${p}"`
    }
  })

  // 打包
  console.log('')
  console.log('⏳ 正在打包...')
  const zipCmd = `cd "${templateDir}" && zip -qr "${outputFile}" . ${excludeArgs}`

  try {
    execSync(zipCmd, { stdio: 'inherit' })
  } catch (err) {
    console.error('❌ 打包失败:', err.message)
    return false
  }

  // 检查结果
  if (fs.existsSync(outputFile)) {
    const stats = fs.statSync(outputFile)
    const sizeMB = (stats.size / (1024 * 1024)).toFixed(2)
    console.log('')
    console.log(`✅ 打包完成!`)
    console.log(`📦 文件: ${outputFile}`)
    console.log(`📊 大小: ${sizeMB} MB`)
    return true
  } else {
    console.error('❌ 打包失败: 输出文件未生成')
    return false
  }
}

// 主逻辑
if (templateName === 'all') {
  console.log('🚀 打包所有模板')
  let success = 0
  for (const key of Object.keys(templates)) {
    if (packTemplate(key)) success++
  }
  console.log('')
  console.log(`📊 完成: ${success}/${Object.keys(templates).length} 个模板打包成功`)
  process.exit(success === Object.keys(templates).length ? 0 : 1)
} else {
  const result = packTemplate(templateName)
  process.exit(result ? 0 : 1)
}
