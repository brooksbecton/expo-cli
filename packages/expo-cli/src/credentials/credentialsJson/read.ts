import spawnAsync from '@expo/spawn-async';
import Joi from '@hapi/joi';
import commandExists from 'command-exists';
import fs from 'fs-extra';
import path from 'path';
import terminalLink from 'terminal-link';

import log from '../../log';
import { Keystore } from '../credentials';

interface CredentialsJson {
  android?: {
    keystore: {
      keystorePath: string;
      keystorePassword: string;
      keyAlias: string;
      keyPassword: string;
    };
  };
  ios?: {
    provisioningProfilePath: string;
    distributionCertificate: {
      path: string;
      password: string;
    };
  };
  experimental?: {
    npmToken?: string;
  };
}

const CredentialsJsonSchema = Joi.object({
  android: Joi.object({
    keystore: Joi.object({
      keystorePath: Joi.string().required(),
      keystorePassword: Joi.string().required(),
      keyAlias: Joi.string().required(),
      keyPassword: Joi.string().required(),
    }),
  }),
  ios: Joi.object({
    provisioningProfilePath: Joi.string().required(),
    distributionCertificate: Joi.object({
      path: Joi.string().required(),
      password: Joi.string().required(),
    }).required(),
  }),
  experimental: Joi.object({
    npmToken: Joi.string(),
  }),
});

interface AndroidCredentials {
  keystore: Keystore;
}

interface iOSCredentials {
  provisioningProfile: string;
  distributionCertificate: {
    certP12: string;
    certPassword: string;
  };
}

export async function fileExistsAsync(projectDir: string): Promise<boolean> {
  return await fs.pathExists(path.join(projectDir, 'credentials.json'));
}

export async function readAndroidCredentialsAsync(
  projectDir: string,
  { skipCredentialsCheck }: { skipCredentialsCheck: boolean }
): Promise<AndroidCredentials> {
  const credentialsJson = await readAsync(projectDir);
  if (!credentialsJson.android) {
    throw new Error('Android credentials are missing from credentials.json'); // TODO: add fyi
  }
  const keystoreInfo = credentialsJson.android.keystore;

  if (!skipCredentialsCheck) {
    await validateKeystoreAsync(keystoreInfo);
  }

  return {
    keystore: {
      keystore: await fs.readFile(getAbsolutePath(projectDir, keystoreInfo.keystorePath), 'base64'),
      keystorePassword: keystoreInfo.keystorePassword,
      keyAlias: keystoreInfo.keyAlias,
      keyPassword: keystoreInfo.keyPassword,
    },
  };
}

export async function readIosCredentialsAsync(projectDir: string): Promise<iOSCredentials> {
  const credentialsJson = await readAsync(projectDir);
  if (!credentialsJson.ios) {
    throw new Error('iOS credentials are missing from credentials.json'); // TODO: add fyi
  }
  return {
    provisioningProfile: await fs.readFile(
      getAbsolutePath(projectDir, credentialsJson.ios.provisioningProfilePath),
      'base64'
    ),
    distributionCertificate: {
      certP12: await fs.readFile(
        getAbsolutePath(projectDir, credentialsJson.ios.distributionCertificate.path),
        'base64'
      ),
      certPassword: credentialsJson.ios.distributionCertificate.password,
    },
  };
}

export async function readSecretEnvsAsync(
  projectDir: string
): Promise<Record<string, string> | undefined> {
  if (!(await fileExistsAsync(projectDir))) {
    return undefined;
  }
  const credentialsJson = await readAsync(projectDir);
  const npmToken = credentialsJson?.experimental?.npmToken;
  return npmToken ? { NPM_TOKEN: npmToken } : undefined;
}

async function readAsync(projectDir: string): Promise<CredentialsJson> {
  const credentialsJSONRaw = await readRawAsync(projectDir);

  const { value: credentialsJson, error } = CredentialsJsonSchema.validate(credentialsJSONRaw, {
    stripUnknown: true,
    convert: true,
    abortEarly: false,
  });
  if (error) {
    throw new Error(`credentials.json is not valid [${error.toString()}]`);
  }

  return credentialsJson;
}

export async function readRawAsync(projectDir: string): Promise<any> {
  const credentialsJsonFilePath = path.join(projectDir, 'credentials.json');
  try {
    const credentialsJSONContents = await fs.readFile(credentialsJsonFilePath, 'utf8');
    return JSON.parse(credentialsJSONContents);
  } catch (err) {
    throw new Error(
      `credentials.json must exist in the project root directory and contain a valid JSON`
    );
  }
}

async function validateKeystoreAsync({
  keystorePath,
  keystorePassword,
  keyAlias,
}: {
  keystorePath: string;
  keystorePassword: string;
  keyAlias: string;
}) {
  try {
    await commandExists('keytool');
  } catch (e) {
    log.warn(
      `Couldn't validate the provided keystore because the 'keytool' command is not available. Make sure that you have a Java Development Kit installed. See ${terminalLink(
        'https://openjdk.java.net',
        'https://openjdk.java.net'
      )} to install OpenJDK.`
    );
    return;
  }

  try {
    await spawnAsync('keytool', [
      '-list',
      '-keystore',
      keystorePath,
      '-storepass',
      keystorePassword,
      '-alias',
      keyAlias,
    ]);
  } catch (e) {
    throw new Error(
      `An error occurred when validating the keystore at '${keystorePath}': ${
        e.stdout || e.message
      }\nMake sure that you provided correct credentials in 'credentials.json' and the path provided under 'keystorePath' points to a valid keystore file.`
    );
  }
}

const getAbsolutePath = (projectDir: string, filePath: string): string =>
  path.isAbsolute(filePath) ? filePath : path.join(projectDir, filePath);
