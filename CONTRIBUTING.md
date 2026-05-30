# Contributing to π Multi-Agent

Thank you for your interest in contributing to π Multi-Agent! This document provides guidelines and instructions for contributing.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Pull Request Process](#pull-request-process)
- [Coding Standards](#coding-standards)
- [Testing Guidelines](#testing-guidelines)
- [Commit Message Guidelines](#commit-message-guidelines)

## Code of Conduct

This project adheres to our [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code. Please report unacceptable behavior to the project maintainers.

## Getting Started

1. **Fork the repository** on GitHub
2. **Clone your fork** locally:
   ```bash
   git clone https://github.com/your-username/Pi-Multi-Agent.git
   cd Pi-Multi-Agent
   ```
3. **Add the upstream remote**:
   ```bash
   git remote add upstream https://github.com/jwangkun/Pi-Multi-Agent.git
   ```
4. **Install dependencies**:
   ```bash
   npm install
   ```

## Development Setup

### Prerequisites

- Node.js 18+
- npm or yarn
- A DeepSeek API key (or OpenAI-compatible endpoint) for testing

### Environment Setup

1. Copy the example environment file:
   ```bash
   cp .env.example .env
   ```
2. Add your API key to `.env`:
   ```
   DEEPSEEK_API_KEY=your_api_key_here
   ```

### Build and Test

```bash
# Build the project
npm run build

# Run type checking
npm run typecheck

# Run tests
npm run test

# Run linting
npm run lint
```

### Development Mode

```bash
# Watch mode for development
npm run dev
```

## Pull Request Process

1. **Create a branch** from `main`:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes** following our coding standards

3. **Test your changes** thoroughly:
   - Run all tests: `npm run test`
   - Ensure type checking passes: `npm run typecheck`
   - Test with example scripts if applicable

4. **Commit your changes** with clear, descriptive messages (see [Commit Message Guidelines](#commit-message-guidelines))

5. **Push to your fork**:
   ```bash
   git push origin feature/your-feature-name
   ```

6. **Open a Pull Request** on GitHub:
   - Use a clear title describing the change
   - Fill out the PR template with all relevant information
   - Link any related issues
   - Wait for CI checks to pass
   - Respond to reviewer feedback

## Coding Standards

### TypeScript

- Use TypeScript for all code (no `.js` files in source)
- Follow strict mode: no `any` types in public APIs
- Use meaningful type names and interfaces
- Prefer `const` over `let` where possible

### Code Style

- Follow existing code formatting (Prettier configuration)
- Use 2-space indentation
- Maximum line length: 100 characters
- Use meaningful variable and function names
- Add JSDoc comments for public APIs

### File Organization

- Keep files focused on a single responsibility
- Group related functionality in modules
- Use index files for clean exports
- Follow the existing directory structure

### Naming Conventions

- **Files**: kebab-case (e.g., `agent-cluster.ts`)
- **Classes**: PascalCase (e.g., `AgentCluster`)
- **Functions/Variables**: camelCase (e.g., `createPlan`)
- **Constants**: UPPER_SNAKE_CASE (e.g., `DEFAULT_TIMEOUT`)
- **Types/Interfaces**: PascalCase (e.g., `AgentConfig`)

## Testing Guidelines

### Writing Tests

- Place tests alongside source files (`.test.ts` suffix)
- Use descriptive test names: `should [expected behavior] when [condition]`
- Test edge cases and error conditions
- Mock external dependencies (API calls, file system)
- Keep tests independent and isolated

### Running Tests

```bash
# Run all tests
npm run test

# Run tests in watch mode
npm run test:watch

# Run specific test file
npx vitest run src/core/agent.test.ts
```

### Test Coverage

Aim for high test coverage, especially for:
- Core functionality
- Public APIs
- Error handling
- Edge cases

## Commit Message Guidelines

### Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Types

- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, etc.)
- `refactor`: Code refactoring
- `test`: Adding or updating tests
- `chore`: Maintenance tasks

### Examples

```
feat(orchestration): add deep planner with LLM-powered task decomposition

- Implement DeepPlanner class with OpenAI API integration
- Add task decomposition with dependency graph
- Include quality thresholds and retry logic

Closes #123
```

```
fix(core): handle timeout errors in agent execution

- Add TimeoutError to error hierarchy
- Implement timeout handling in Agent.execute()
- Add tests for timeout scenarios
```

```
docs(readme): update quick start examples

- Add installation instructions
- Include collaboration mode examples
- Fix code snippet formatting
```

## Questions?

If you have questions or need help, please:

1. Check existing issues and discussions
2. Read the documentation
3. Ask in the project community channels

Thank you for contributing to π Multi-Agent! 🎉
