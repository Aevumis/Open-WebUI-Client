import React, { Component, ErrorInfo, ReactNode } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { error as logError } from "../lib/log";
import { router } from "expo-router";

interface Props {
  children: ReactNode;
  name?: string; // Optional name to identify which boundary caught the error
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * A React Error Boundary component to catch JavaScript errors in their child component tree,
 * log those errors, and display a fallback UI instead of the component tree that crashed.
 */
export class ErrorBoundary extends Component<Props, State> {
  public override state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    const componentName = this.props.name || "Global";
    logError("error-boundary", `Error caught by ${componentName} boundary`, {
      error: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
    });
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
    // Optional: Navigate to home or reload if needed.
    // For now, we just try to re-render the children.
    // If the error persists, it will crash again immediately.
    // In some cases, you might want to redirect:
    router.replace("/");
  };

  public override render() {
    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <View style={styles.card}>
            <Text style={styles.title}>Something went wrong</Text>
            <Text style={styles.message}>We encountered an unexpected error.</Text>
            {this.state.error && (
              <Text style={styles.errorText}>{this.state.error.toString()}</Text>
            )}
            <TouchableOpacity style={styles.button} onPress={this.handleReset}>
              <Text style={styles.buttonText}>Return to Home</Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f3f4f6", // Light gray background
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  card: {
    backgroundColor: "#ffffff",
    padding: 24,
    borderRadius: 12,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    maxWidth: 400,
    width: "100%",
  },
  title: {
    fontSize: 20,
    fontWeight: "bold",
    marginBottom: 8,
    color: "#1f2937",
  },
  message: {
    fontSize: 16,
    color: "#4b5563",
    textAlign: "center",
    marginBottom: 16,
  },
  errorText: {
    fontSize: 12,
    color: "#ef4444", // Red
    fontFamily: "monospace",
    marginBottom: 20,
    textAlign: "center",
    backgroundColor: "#fef2f2",
    padding: 8,
    borderRadius: 4,
    width: "100%",
  },
  button: {
    backgroundColor: "#111827",
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
  },
  buttonText: {
    color: "#ffffff",
    fontWeight: "600",
    fontSize: 16,
  },
});
