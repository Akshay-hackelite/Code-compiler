const stubs = {};

stubs.cpp = `#include <iostream>
#include <stdio.h>

using namespace std;

int main() {
  cout<<"Hello world!";
  return 0;
}
`;

stubs.py = `print("Hello world!")`;
stubs.java = `import java.util.*;
import java.lang.*;
import java.io.*;

// The main method must be in a class named "Main"
class Main {
    public static void main(String[] args) {
        System.out.println("Hello world!");
    }
}
`;

stubs.c = `#include <stdio.h>

int main() {
    printf("Hello world!");
    return 0;
}
`;
export default stubs;
